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
    // parentOf: the mechanism the next one added rides on (+ Add to this), or null for one on the robot itself.
    let picking=false,lastKey='',parentOf=null;
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
      // A third motor or servo on, as many as the part needs: each its own name (and port, in Setup), driven with the first.
      const moreDevices=a=>{if(!a.device2)return '';const word=a.kind==='dcmotor'?'motor':'servo',max=root.DeckKinematics?.MORE_DEVICES??5,list=a.more||[];
        return `${list.map((x,i)=>`<div class="start-xy"><div><label>${['Third','Fourth','Fifth','Sixth','Seventh'][i]} ${word}<input data-m-more="${i}" maxlength="40" autocomplete="off" spellcheck="false" value="${esc(x.device)}"></label></div><label class="check sim-mech-reverse"><input type="checkbox" data-m-more-rev="${i}"${x.reversed?' checked':''}> Mounted mirrored</label><button type="button" class="text-button" data-m="more-off" data-v="${i}">Remove</button></div>`).join('')}${list.length<max?`<button type="button" class="secondary" data-m="more-add">+ Add another ${word}</button>`:''}`;};
      const kindSelect=`<select data-m-f="actuator" aria-label="Driven by">${opt('dcmotor','DC motor',kind==='dcmotor')}${opt(isServo?kind:'servo','Servo',isServo)}${others.map(k=>opt(k,ftc?`${kinds[k]} (not legal on an FTC robot)`:kinds[k],k===kind)).join('')}${opt('none','Nothing: it moves at its own speed',kind==='none')}</select>`;
      const servoSelect=isServo?`<div><label>Servo type<select data-m-f="actuator" aria-label="Servo type">${SERVO_KINDS.map(([k,t])=>opt(k,t,k===kind)).join('')}</select></label></div>`:'';
      let body='';
      if(!a)body=`<div class="start-xy">${num('data-m-f="speed"',j.speed??90,{label:`Moves at · ${u}/s`,min:.01})}</div><p class="hint">Without a motor or servo it moves to each named position at this speed.</p>`;
      else{
        const models=Ax?Ax.of(a.kind):[],model=models.length?`<div><label>Model<select data-m-f="model">${opt('','Another one (set its numbers)',!a.model)}${models.map(md=>opt(md.id,md.name,md.id===a.model)).join('')}</select></label></div>`:'';
        const rev=a.kind==='servo'||a.kind==='linear'?'Higher positions move it the other way':'Turns the other way (REVERSE)';
        body=`<div class="start-xy">${model}<div><label>Name in the robot configuration<input data-m-f="device" maxlength="40" autocomplete="off" spellcheck="false" value="${esc(a.device||Ax?.camel(a.name)||'')}"></label></div></div>
          <label class="check sim-mech-reverse"><input type="checkbox" data-m-f="reversed"${a.reversed?' checked':''}> ${rev}</label>
          ${['dcmotor','servo','crservo','linear'].includes(a.kind)?`<div class="start-xy"><div><label>Second ${a.kind==='dcmotor'?'motor':'servo'} on this part (optional)<input data-m-f="device2" maxlength="40" autocomplete="off" spellcheck="false" placeholder="None" value="${esc(a.device2||'')}"></label></div>${a.device2?`<label class="check sim-mech-reverse"><input type="checkbox" data-m-f="reversed2"${a.reversed2?' checked':''}> It is mounted mirrored (turns the other way)</label>`:''}</div>${moreDevices(a)}<p class="hint">A lift on two motors (left and right) or a wrist on two servos: all of them get the same commands.</p>`:''}`;
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
      return `<section class="sim-mech-part sim-mech-moving" data-mech="${esc(j.id)}" data-depth="${Math.min(depth,3)}"${parent?` data-parent="${esc(parent.id)}"`:''}><div class="sim-mech-head"><h4>${esc(j.name)}<em class="sim-joint-kind">${esc(t.name)}${parent?` · on ${esc(parent.name)}`:''}</em></h4><small class="sim-joint-badge" data-level="${lv}">${said}</small><button type="button" class="icon-button" data-m="remove" aria-label="Remove ${esc(j.name)}" title="Remove">×</button></div>
        <p class="hint">${esc(t.blurb)} ${where}</p>${j.product?`<p class="sim-mech-product" data-product><b>${esc(j.product.vendor)}</b> ${esc(j.product.name)}${j.product.sku?` · <code>${esc(j.product.sku)}</code>`:''}${j.product.url?` · <span class="hint">${esc(j.product.url.replace(/^https:\/\/(www\.)?/,'').split('/')[0])}</span>`:''}</p>`:''}
        <div class="sim-joint-buttons">${cad?`<button type="button" class="secondary" data-m="show">Show on model</button><button type="button" class="secondary" data-m="choose">${j.parts?.length?'Change its parts':'Choose its parts'}</button>`:''}<button type="button" class="secondary" data-m="sub" title="A mechanism that rides on this one: a claw on an arm, a wrist on a lift">+ Add to ${esc(j.name)}</button></div>
        <div class="start-xy"><div><label>Name<input data-m-f="name" maxlength="40" autocomplete="off" value="${esc(j.name)}"></label></div><div><label>Mechanism<select data-m-f="kind">${T.grouped().map(g=>`<optgroup label="${esc(g.name)}">${g.types.map(x=>opt(x.id,x.name,x.id===j.kind)).join('')}</optgroup>`).join('')}</select></label></div></div>
        ${positions(j,a)}${actuator(j,a)}<div class="sim-wire-block" data-wire-for="kin:${esc(j.id)}"></div></section>`;}
    // + Add mechanism: a pop-up. Categories across the top (what it does), then where it comes from: Generic (any team's own
    // build) or a vendor's FTC kit or part (DeckMechCatalog), each a picture card. Search looks in every category.
    // pickSrc: '' shows every card of the category; a company's id shows only its products.
    let pickCat=null,pickSrc='';
    // The reference library (DeckMechLibrary, records in DeckMechLibraryData): a card per record, opened for what it is,
    // how it works, its numbers, its trade-offs and its sources. A record that replaces a generic kind (its id is that
    // kind's) adds under the kind's own value; the rest add as lib:<id>. A record with no joint type is reference only.
    const L=()=>root.DeckMechLibrary,LIB=()=>Array.isArray(root.DeckMechLibraryData)?root.DeckMechLibraryData:[];let libIndex=null,libFrom=null;
    const libById=()=>{if(libFrom!==LIB()||libIndex.size!==LIB().length){libFrom=LIB();libIndex=new Map(libFrom.map(r=>[r.id,r]));}return libIndex;};
    const libOf=v=>{v=String(v||'');if(v.startsWith('lib:'))return libById().get(v.slice(4))||null;const r=libById().get(v);return r&&r.type===v?r:null;};
    const libValue=r=>TY().TYPES[r.id]&&r.type===r.id?r.id:'lib:'+r.id;
    // A record's picture: the photo another card already reads when it is the same one, else its own (mech:lib:<id>).
    function libFig(r){const Art=globalThis.DeckDeviceArt,P=Art?.PHOTOS;if(!P||!r.image?.page)return '';const own=L()?.photos?.([r])||{};for(const [k,v] of Object.entries(own))if(!P[k])P[k]=v;
      const same=Object.keys(P).find(k=>k.startsWith('mech:')&&!k.startsWith('mech:lib:')&&P[k][0]===r.image.page&&(P[k][2]?.image||null)===(r.image.src||null));return same||(P['mech:lib:'+r.id]?'mech:lib:'+r.id:'');}
    const seasonName=s=>s==='general'?'Any season':s==='biobuzz'?'BIOBUZZ':/^historical:/.test(s)?'Past game: '+s.slice(11).replace(/-/g,' '):s;
    const LEGAL={'not-verified':'Not checked against the rules yet','rule-checked':'Checked against the rules','not-allowed':'Not allowed'};
    function libCard(r){const Lb=L(),C=root.DeckMechCatalog,fig=libFig(r),kind=r.image?Lb.IMAGES[r.image.kind]||'':'',v=r.type?libValue(r):'',seasons=Lb.seasonsOf(r).join(' ');
      return `<div class="sim-mech-type sim-mech-pic sim-mech-lib" data-lib="${esc(r.id)}" data-cat="${esc(r.category)}" data-src="library" data-find="${esc(Lb.words(r))}" data-entry="${esc(r.entry)}" data-difficulty="${esc(r.difficulty)}" data-actuation="${esc(r.actuation)}" data-seasons="${esc(seasons)}" data-photo="${fig?1:''}" title="${esc(r.short)}">
        <button type="button" class="sim-mech-lib-open" data-lib-open="${esc(r.id)}" aria-label="${esc(r.name)}: what it is and how it works"><span class="sim-mech-type-art"${fig?` data-fig="${esc(fig)}"`:''}>${C?C.picFor(r.type||''):''}</span>${kind?`<span class="sim-mech-lib-img">${esc(kind)}</span>`:''}<strong>${esc(r.name)}</strong><small>${esc(r.short)}</small></button>
        <span class="sim-mech-lib-foot"><span class="sim-mech-lib-chip" data-entry-chip>${esc(Lb.ENTRIES[r.entry]||r.entry)}</span>${v?`<button type="button" class="secondary sim-mech-lib-add" data-m="add" data-v="${esc(v)}" aria-label="Add ${esc(r.name)}">Add</button>`:`<span class="sim-mech-lib-ref">Reference only</span>`}</span></div>`;}
    // The record opened: overview, how it works, its numbers, engineering notes and references, then Add to robot.
    function libDetail(r){const Lb=L(),C=root.DeckMechCatalog,fig=libFig(r),list=(t,xs)=>xs?.length?`<h4>${t}</h4><ul>${xs.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'',row=(t,v)=>v==null||v===''?'':`<dt>${t}</dt><dd>${v}</dd>`;
      // A choice shows its choices (read only: the part's own card is where its numbers change once it is added).
      const params=(r.params||[]).map(p=>p.unit==='choice'?`<li data-param="${esc(p.key)}"><b>${esc(p.label)}</b> <select disabled aria-label="${esc(p.label)}">${(p.choices||[]).map(c=>opt(c,c,c===p.default)).join('')}</select>${p.estimate?' <em class="sim-mech-lib-est">estimate</em>':''}</li>`:(()=>{const u=p.unit?` ${esc(p.unit)}`:'',range=p.min!=null||p.max!=null?` <span class="hint">${p.min??''}–${p.max??''}${u}</span>`:'';return `<li data-param="${esc(p.key)}"><b>${esc(p.label)}</b> ${p.default!=null?`${esc(p.default)}${u}`:''}${range}${p.estimate?' <em class="sim-mech-lib-est">estimate</em>':''}</li>`;})()).join('');
      const legal=r.legality||{},host=u=>{try{return new URL(u).hostname.replace(/^www\./,'');}catch{return '';}};
      const refs=(r.refs||[]).map(f=>`<li><b>${esc(f.title)}</b> <span class="hint">${esc(host(f.url))} · ${esc(f.kind)}</span> <button type="button" class="text-button" data-m="ref" data-v="${esc(f.url)}">${root.deck?.openExternal?'Open':'Copy link'}</button></li>`).join('');
      const kind=r.image?Lb.IMAGES[r.image.kind]||'':'';
      return `<div class="sim-mech-lib-top"><button type="button" class="secondary" data-lib-back>← All mechanisms</button><span class="sim-mech-lib-chip">${esc(Lb.ENTRIES[r.entry]||r.entry)}</span></div>
        <div class="sim-mech-lib-hero"><figure><span class="sim-mech-type-art"${fig?` data-fig="${esc(fig)}"`:''}>${C?C.picFor(r.type||''):''}</span>${kind?`<figcaption class="sim-mech-lib-img">${esc(kind)}${r.image.shows?`: ${esc(r.image.shows)}`:''}${r.image.credit?` · ${esc(r.image.credit)}`:''}</figcaption>`:''}</figure>
        <div><h3>${esc(r.name)}</h3>${r.aliases?.length?`<p class="hint">Also called ${r.aliases.map(esc).join(', ')}</p>`:''}
        ${r.type?(partial(r)?`<button type="button" class="primary" data-m="add" data-v="lib:${esc(r.id)}" data-lib-add>Add one ${esc(TY().TYPES[r.type]?.name.toLowerCase()||'part')}</button><p class="hint">This is a whole ${r.entry==='architecture'?'robot design':'mechanism'} with ${Number.isInteger(r.dof)?`${r.dof} degrees of freedom`:'several parts'}: this adds one of its joints. Add the others the same way and put them on it.</p>`:`<button type="button" class="primary" data-m="add" data-v="lib:${esc(r.id)}" data-lib-add>Add to robot</button>`):`<button type="button" class="secondary" data-lib-add disabled>Reference only: nothing moves on the model</button>`}</div></div>
        <section data-lib-section="overview"><h4>Overview</h4><p>${esc(r.short)}</p><dl>${row('What it is',esc(Lb.ENTRIES[r.entry]||r.entry))}${row('Difficulty',esc(r.difficulty))}${row('Status',esc(r.status))}${row('Used in',(r.seasons||[]).map(s=>esc(seasonName(s))).join(', '))}</dl>${list('Where it is used',r.uses)}</section>
        <section data-lib-section="how"><h4>How it works</h4><p>${esc(r.how)}</p><dl>${r.motion?row('Motion',`${esc(r.motion.input)} → ${esc(r.motion.output)}`):''}${row('Degrees of freedom',r.dof==null?'':esc(r.dof))}${row('Driven by',esc(r.actuation))}${r.type?row('Moves on the model as',esc(TY().TYPES[r.type]?.name||r.type)):''}</dl></section>
        ${params?`<section data-lib-section="configure"><h4>Configure</h4><ul class="sim-mech-lib-params">${params}</ul>${(r.params||[]).some(p=>p.estimate)?'<p class="hint">An estimate is a starting point: measure it on your robot.</p>':''}</section>`:''}
        <section data-lib-section="notes"><h4>Engineering notes</h4><div class="sim-mech-lib-cols">${list('Pros',r.pros)}${list('Cons',r.cons)}${list('How it fails',r.failures)}</div>
          <dl>${row('Legality',esc(LEGAL[legal.status]||legal.status||'')+(legal.rules?.length?` (${legal.rules.map(esc).join(', ')})`:'')+(legal.note?` · ${esc(legal.note)}`:''))}${row('Confidence',esc(r.confidence))}${row('Last checked',esc(r.verified))}</dl></section>
        <section data-lib-section="refs"><h4>References</h4><ul class="sim-mech-lib-refs">${refs}</ul></section>`;}
    function openLib(id){const box=picker.querySelector('.sim-mech-types'),r=libById().get(id),d=box?.querySelector('.sim-mech-lib-detail');if(!r||!d)return;
      d.innerHTML=libDetail(r);d.hidden=false;box.dataset.detail=id;globalThis.DeckPartPicker?.dress?.(d);d.scrollTop=0;d.querySelector('[data-lib-back]')?.focus();}
    function closeLib(){const box=picker.querySelector('.sim-mech-types'),d=box?.querySelector('.sim-mech-lib-detail');if(!d||d.hidden)return;const id=box.dataset.detail;d.hidden=true;d.innerHTML='';delete box.dataset.detail;
      box.querySelector(`[data-lib-open="${CSS.escape(id||'')}"]`)?.focus();}
    // The filters' choices: only what the cards have.
    function filtersHtml(records){const Lb=L(),seen=k=>[...new Set(records.flatMap(r=>k==='season'?Lb.seasonsOf(r):[r[k]]))],
        sel=(k,label,order,name=x=>x)=>{const have=seen(k),opts=order.filter(x=>have.includes(x));return `<label>${label}<select data-filter="${k}"><option value="">Any</option>${opts.map(x=>opt(x,name(x),false)).join('')}</select></label>`;};
      return `<div class="sim-mech-filters" hidden>${sel('entry','Kind',Object.keys(Lb.ENTRIES),x=>Lb.ENTRIES[x])}${sel('difficulty','Difficulty',Lb.DIFFICULTY)}${sel('actuation','Driven by',Lb.ACTUATION)}${sel('season','Season',['biobuzz','general','historical'],x=>({biobuzz:'BIOBUZZ',general:'Any season',historical:'Past games'})[x])}
        <label class="check"><input type="checkbox" data-filter="photo"> Has a photo</label><button type="button" class="text-button" data-filters-clear>Clear</button></div>`;}
    function pickerHtml(){
      const T=TY(),C=root.DeckMechCatalog,game=api.game(),ftc=api.ftc?.()!==false,words=t=>(t.name+' '+t.blurb+' '+String(t.words||'').replace(/\\[a-z]/gi,' ').replace(/[^a-z0-9]+/gi,' ')).toLowerCase();
      const pic=id=>C?C.picFor(id):'',cards=[];
      const card=({id,name,blurb,find,cat,src,art,note='',specs='',warn='',family='',more=0})=>`<button type="button" class="sim-mech-type sim-mech-pic" data-m="add" data-v="${esc(id)}" data-cat="${esc(cat)}" data-src="${esc(src)}" data-find="${esc(find)}"${family?` data-family="${esc(family)}"${more?` data-more="${more}"`:''}`:''} ${globalThis.DeckDeviceArt?.photoOf?.('mech:'+id)?' data-photo="1"':''} title="${esc(blurb)}"><span class="sim-mech-type-art"${globalThis.DeckDeviceArt?.photoOf?.('mech:'+id)?` data-fig="mech:${esc(id)}"`:''}>${art}</span><strong>${esc(name)}</strong><small>${esc(blurb)}</small>${specs?`<span class="sim-mech-type-specs">${esc(specs)}</span>`:''}${note?`<em>${esc(note)}</em>`:''}${warn?`<em class="sim-mech-type-warn" title="${esc(warn)}">Check R301</em>`:''}${more?`<em class="sim-mech-type-more">+${more} more size${more>1?'s':''}: pick “Only from ${esc(note.split(' · ')[0])}”</em>`:''}</button>`;
      // The picker offers what teams can buy: each card is a company's mechanism kit, shown with its own listing photo, plus
      // Your own for anything else. On BIOBUZZ a kit that takes in or launches balls is also under BIOBUZZ, as the game's own.
      const KITS_ONLY=true;
      // A kind is a card when a company sells one (its store photo, ftc/mech-photos.js), and Your own always: the rest are
      // kept for robots that already have them (each card's Mechanism list still offers them) but are not offered here.
      // A kind whose photo is a company part listed in the same category shows as that part alone, not twice.
      const sold=id=>!!globalThis.DeckDeviceArt?.photoOf?.('mech:'+id),bare=u=>String(u||'').replace(/\/$/,''),
        twin=t=>{const page=bare(globalThis.DeckDeviceArt?.photoOf?.('mech:'+t.id)?.page);return !!page&&(C?.ITEMS||[]).some(i=>bare(i.url)===page&&(i.category||T.TYPES[i.type]?.group)===t.group);};
      // The library's records first in each category; a generic kind a record replaces is not shown twice.
      const records=L()&&!KITS_ONLY?LIB().filter(r=>r&&r.id&&r.category&&(game||r.category!=='game')):[],replaced=new Set(records.filter(r=>r.type===r.id).map(r=>r.id));for(const r of records)cards.push(libCard(r));
      for(const g of T.grouped())for(const t of g.types){if(replaced.has(t.id)||KITS_ONLY&&t.group!=='custom')continue;if(ftc&&t.motor&&!FTC_KINDS.includes(t.motor.kind))continue;if(t.group!=='custom'&&globalThis.DeckDeviceArt&&(!sold(t.id)||twin(t)))continue;cards.push(card({id:t.id,name:t.name,blurb:t.blurb,find:words(t),cat:t.group,src:'generic',art:pic(t.id),note:game&&AS_GAME[t.id]?`BIOBUZZ ${AS_GAME[t.id][0]}`:''}));}
      // One card for a product sold in several sizes or ratios (Stingray-2 to -9, a slide in two lengths): its first one, with
      // the rest shown when that company is picked or searched for.
      const familyOf=id=>/^os-(btsk-|ultimate-)/.test(id)?'os-box-tube':'',
        firstOf=new Map(),count=new Map();for(const it of C?.ITEMS||[]){const f=familyOf(it.id);if(!f)continue;if(!firstOf.has(f))firstOf.set(f,it.id);count.set(f,(count.get(f)||0)+1);}
      for(const it of C?.ITEMS||[]){const t=T.TYPES[it.type];if(!t)continue;const v=C.vendor(it.vendor),fam=familyOf(it.id),lead=fam&&firstOf.get(fam)===it.id;
        if(game&&it.biobuzz)cards.push(card({id:'cat:'+it.id,name:it.name,blurb:it.blurb||t.blurb,find:`${it.name} ${it.blurb||''} ${v?.name||''} ${it.sku||''} ${it.biobuzz} biobuzz`.toLowerCase(),cat:'game',src:it.vendor,art:pic(it.type),specs:(it.specs||[]).join(' · '),note:`${v?.name||it.vendor} · BIOBUZZ ${it.biobuzz}`}));
        cards.push(card({family:fam?(lead?'lead':'rest'):'',more:lead?count.get(fam)-1:0,id:'cat:'+it.id,name:it.name,blurb:it.blurb||t.blurb,find:`${it.name} ${it.blurb||''} ${v?.name||''} ${it.sku||''} ${words(t)}`.toLowerCase(),cat:it.category||t.group,src:it.vendor,art:pic(it.type),specs:(it.specs||[]).join(' · '),note:`${v?.name||it.vendor}${it.sku?` · ${it.sku}`:''}`,warn:it.legal||''}));}
      const has=(cat,src)=>cards.some(c=>c.includes(`data-cat="${cat}"`)&&(!src||c.includes(`data-src="${esc(src)}"`)));
      const cats=(L()&&!KITS_ONLY?L().CATEGORIES.filter(([k])=>game||k!=='game'):[...(game?[['game','BIOBUZZ']]:[]),...(C?.CATEGORIES||T.grouped().map(g=>[g.id,g.name]))]).filter(([k])=>has(k));
      if(!cats.some(([k])=>k===pickCat))pickCat=cats[0]?.[0]||null;
      const srcs=[...(C?.VENDORS||[]).filter(v=>(C.ITEMS||[]).some(i=>i.vendor===v.id)).map(v=>[v.id,v.name])];
      const on=parentOf&&kin().joints.find(x=>x.id===parentOf);
      return `<div class="sim-mech-types" role="group" aria-label="${on?`Add to ${esc(on.name)}`:'Add a mechanism'}" data-pick-cat="${esc(pickCat||'')}" data-pick-src="${esc(pickSrc)}">
        <div class="sim-mech-types-head"><h2>${on?`Add to ${esc(on.name)}`:'Add a mechanism'}</h2><input type="search" data-types-search aria-label="Search mechanisms" placeholder="Search: claw, Viper slide, turret, hang…"><button type="button" class="icon-button" data-m="close" aria-label="Close">×</button></div>
        ${on?`<p class="sim-mech-adding" data-adding-to="${esc(on.id)}">It rides on <b>${esc(on.name)}</b> and moves with it.</p>`:''}
        <div class="sim-mech-cats" role="tablist" aria-label="What it does">${cats.map(([k,n])=>`<button type="button" role="tab" class="sim-mech-cat" data-pick-cat="${esc(k)}" aria-selected="${k===pickCat}">${esc(n)}</button>`).join('')}${records.length?`<button type="button" class="sim-mech-cat sim-mech-filters-toggle" data-filters-toggle aria-expanded="false">Filters</button>`:''}</div>
        ${records.length?filtersHtml(records):''}
        <div class="sim-mech-srcs" role="group" aria-label="Only one company’s parts"><span class="sim-mech-srcs-label">Only from</span>${srcs.map(([k,n])=>`<button type="button" class="sim-mech-src" data-pick-src="${esc(k)}" aria-pressed="${k===pickSrc}">${esc(n)}</button>`).join('')}</div>
        <div class="sim-mech-type-grid">${cards.join('')}</div><div class="sim-mech-lib-detail" role="region" aria-label="About this mechanism" hidden></div>
        <p class="hint sim-mech-types-none" hidden>Nothing here. Try another category or source, or Your own: something that pivots, slides or spins.</p>
        <p class="hint sim-mech-types-foot">Every photo is from the company’s own store listing (hover it for which). A company’s part comes with its numbers (travel, gearing, motor or servo); change any of them on its card.</p></div>`;}
    // What shows: the category and source picked, or every category matching the search.
    // Filters (the library's kind, difficulty, what drives it, season, a photo) narrow what shows; a card from outside the
    // library has none of those, so it shows only for Has a photo.
    function refilter(){const box=picker.querySelector('.sim-mech-types');if(!box)return;const words=(box.querySelector('[data-types-search]')?.value||'').trim().toLowerCase().split(/\s+/).filter(Boolean);let any=false;
      const F={};for(const el of box.querySelectorAll('[data-filter]')){const v=el.type==='checkbox'?el.checked:el.value;if(v)F[el.dataset.filter]=v;}
      const passes=b=>(!F.entry||b.dataset.entry===F.entry)&&(!F.difficulty||b.dataset.difficulty===F.difficulty)&&(!F.actuation||b.dataset.actuation===F.actuation)&&(!F.season||` ${b.dataset.seasons||''} `.includes(` ${F.season} `))&&(!F.photo||b.dataset.photo==='1');
      {const t=box.querySelector('[data-filters-toggle]'),n=Object.keys(F).length;if(t)t.textContent=n?`Filters · ${n}`:'Filters';}
      // Only the companies with something in this category.
      const cards=[...box.querySelectorAll('[data-find]')];for(const r of box.querySelectorAll('button[data-pick-src]')){const k=r.dataset.pickSrc;r.hidden=!words.length&&!cards.some(c=>c.dataset.src===k&&c.dataset.cat===pickCat);}
      if(pickSrc&&box.querySelector(`button[data-pick-src="${CSS.escape(pickSrc)}"]`)?.hidden!==false)pickSrc='';
      {const row=box.querySelector('.sim-mech-srcs');if(row)row.hidden=!row.querySelector('button[data-pick-src]:not([hidden])');}
      for(const b of box.querySelectorAll('[data-find]')){const on=(words.length?words.every(w=>b.dataset.find.includes(w)):b.dataset.cat===pickCat&&(pickSrc?b.dataset.src===pickSrc:b.dataset.family!=='rest'))&&passes(b);b.hidden=!on;any||=on;
        const more=b.querySelector('.sim-mech-type-more');if(more)more.hidden=!!pickSrc||words.length>0;}
      for(const t of box.querySelectorAll('[data-pick-cat]'))if(t.matches('button'))t.setAttribute('aria-selected',String(!words.length&&t.dataset.pickCat===pickCat));
      for(const s of box.querySelectorAll('button[data-pick-src]'))s.setAttribute('aria-pressed',String(s.dataset.pickSrc===pickSrc));
      const none=box.querySelector('.sim-mech-types-none');if(none)none.hidden=any;}
    function render(){
      const typing=(host.contains(document.activeElement)||picker.contains(document.activeElement))&&document.activeElement.matches('input:not([type=checkbox]),select');
      const k=kin(),key=JSON.stringify([k.joints,k.actuators,k.couplings,api.cad(),api.game()]);
      if(!typing&&key!==lastKey){lastKey=key;const open=new Set([...host.querySelectorAll('details[open]')].map(d=>d.closest('[data-mech]')?.dataset.mech));
        host.innerHTML=listed().map(([j,d])=>card(j,d)).join('');for(const d of host.querySelectorAll('details'))d.open=open.has(d.closest('[data-mech]')?.dataset.mech);}
      picker.hidden=!picking;if(picking&&!picker.firstChild){picker.innerHTML=pickerHtml();refilter();globalThis.DeckPartPicker?.dress?.(picker);}
      api.counted?.(listed().length);api.decorate?.(host);
    }
    function setPicking(on,parent=null){picking=on;parentOf=on?parent:null;picker.innerHTML='';render();api.adding?.(on);if(on)picker.querySelector('[data-types-search]')?.focus();}
    // Changes go through a copy of the model, committed at once.
    function change(fn){const next=structuredClone(kin());if(fn(next)===false)return;api.commit(next);}
    const jointOf=(next,id)=>next.joints.find(x=>x.id===id),actOf=(next,id)=>next.actuators.find(x=>x.joint===id);
    // A motor's id: its part's with "_motor" (ids are 32 characters at most), unique.
    function motorId(next,jid){let mid=jid.slice(0,24)+'_motor',n=2;while(next.actuators.some(x=>x.id===mid)||next.joints.some(x=>x.id===mid))mid=jid.slice(0,22)+'_motor'+n++;return mid;}
    // A record that is more than one joint (a whole robot design, a 2-link arm, a 6-leg platform) adds one of its joints.
    function partial(r){return r.entry==='architecture'||Number.isInteger(r.dof)&&r.dof>1;}
    // A part's name: the record's, without its explanation in brackets, short enough for a name box and a route action and
    // never ending on "with" or "for". One joint of a bigger design is named for the joint ("Hip"), not the whole design.
    const shortName=r=>{if(partial(r))return TY().TYPES[r.type]?.name||r.name;let n=r.name.replace(/\s*\([^)]*\)\s*/g,' ').replace(/\s+/g,' ').trim();
      if(n.length>40)n=n.slice(0,40).replace(/\s+\S*$/,'');while(/\s(with|for|and|or|of|to|the|a)$/i.test(n))n=n.replace(/\s+\S+$/,'');return n;};
    // What drives a record's part when the record says (a motor-driven wrist, a continuous-servo feeder), not the type's
    // usual one; a servo that slides is a linear servo.
    const kindOf=r=>r.actuation==='servo'&&TY().TYPES[r.type]?.joint==='prismatic'?'linear':({motor:'dcmotor',servo:'servo',crservo:'crservo'})[r.actuation];
    function add(id){
      // A library record adds as its joint type; one with none moves nothing and is not added.
      const rec=libOf(id);if(rec){if(!rec.type||!TY().TYPES[rec.type])return;id=rec.type;}
      if(id.startsWith('game:')){const [,what,kind]=id.split(':');const label=api.addGame(what,kind);setPicking(false);status(label?`${label} added. Configure from CAD finds it in your CAD by name.`:`The robot already has as many ${what}s as BIOBUZZ allows.`);return;}
      if(api.game()&&AS_GAME[id]){const label=api.addGame(...AS_GAME[id]);if(label){setPicking(false);status(`${label} added: on BIOBUZZ it is the game’s own ${AS_GAME[id][0]}. Configure from CAD finds it in your CAD by name.`);return;}}
      const C=root.DeckMechCatalog,item=id.startsWith('cat:')?C?.ITEMS.find(x=>x.id===id.slice(4)):null;if(item)id=item.type;
      if(item&&api.game()&&item.biobuzz){const as=AS_GAME[item.type]||(item.biobuzz==='shooter'?['shooter','fixed']:['intake','sweeper']),label=api.addGame(...as);if(label){setPicking(false);status(`${item.name} added as ${label}: on BIOBUZZ it is the game’s own ${as[0]}.`);return;}}
      const on=parentOf,jid=api.joints().add(id,item?{name:item.name}:rec?{name:shortName(rec)}:{});setPicking(false);if(!jid)return;
      // A library record: its named positions, travel and speed on the new part, and its motor or servo refitted to them.
      if(rec)change(next=>{const j=jointOf(next,jid),p=rec.preset||{},i=next.actuators.findIndex(x=>x.joint===jid);if(!j)return false;
        if(p.states&&typeof p.states==='object')j.states={...p.states};for(const k of ['upper','lower'])if(finite(p[k]))j[k]=p[k];if(finite(p.speed))j.speed=p.speed;
        const want=kindOf(rec),a0=i>=0?next.actuators[i]:null;if(a0&&A()&&want&&a0.kind!==want&&FTC_KINDS.includes(want))next.actuators[i]={...A().create({id:a0.id,joint:jid,name:j.name,spec:{kind:want},speed:j.speed??90,travel:A().travelOf(j),states:j.states}),...(a0.device?{device:a0.device}:{})};
        const a=i>=0?next.actuators[i]:null;if(a&&A()&&FTC_KINDS.includes(a.kind)){const spec=TY().motorFor(id);if(spec.kind===a.kind)next.actuators[i]={...A().create({id:a.id,joint:jid,name:j.name,spec,speed:j.speed??90,travel:A().travelOf(j),states:j.states}),...(a.device?{device:a.device}:{})};
          if(finite(p.speed))next.actuators[i].speed=p.speed;if(!finite(p.upper)&&!finite(p.lower))fitLimits(j,next.actuators[i]);}});
      if(item)change(next=>{const j=jointOf(next,jid),i=next.actuators.findIndex(x=>x.joint===jid);if(!j)return false;const r=C.apply(item,j,i>=0?next.actuators[i]:null,{A:A()});Object.assign(j,r.joint);if(i>=0&&r.actuator){next.actuators[i]=r.actuator;fitLimits(j,next.actuators[i]);}});
      // Added to another mechanism: it rides on it.
      if(on&&kin().joints.some(x=>x.id===on))change(next=>{const j=jointOf(next,jid);if(!j)return false;j.parent=on;});
      const j=kin().joints.find(x=>x.id===jid),host_=on&&kin().joints.find(x=>x.id===on);
      status(`${j?.name||'Mechanism'} added${host_?` on ${host_.name}`:''}. ${api.cad()?'Press Configure from CAD to find it in your CAD by name, or choose its parts on the model.':'Import your robot’s CAD to see it move.'}`);
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
      if(what==='more-add'){change(next=>{const a=actOf(next,id);if(!a?.device2)return false;const list=a.more||[],taken=new Set([a.device,a.device2,...list.map(x=>x.device)]);let n=list.length+3,name=`${a.device2.replace(/\d+$/,'')}${n}`;while(taken.has(name))name=`${a.device2.replace(/\d+$/,'')}${++n}`;a.more=[...list,{device:name.slice(0,40)}];});return;}
      if(what==='more-off'){change(next=>{const a=actOf(next,id);if(!a?.more)return false;a.more.splice(+b.dataset.v,1);if(!a.more.length)delete a.more;});return;}
      if(what==='show'){api.joints().open(id);return;}
      if(what==='sub'){setPicking(true,id);api.picking?.();return;}
      if(what==='choose'||what==='gearing'){api.joints().open(id,{choose:what==='choose'});return;}
      if(what==='state'){change(next=>{const j=jointOf(next,id),s=j.states||{};let n=Object.keys(s).length+1,name='position '+n;while(name in s)name='position '+ ++n;s[name]=0;j.states=s;});return;}
      if(what==='unstate'){change(next=>{const j=jointOf(next,id);delete j.states[b.dataset.v];});return;}
      if(what==='state-show'){const j=kin().joints.find(x=>x.id===id),v=j?.states?.[b.dataset.v];if(finite(v))api.joints().pose?.(id,v);return;}});
    picker.addEventListener('click',e=>{
      {const o=e.target.closest('[data-lib-open]');if(o)return openLib(o.dataset.libOpen);if(e.target.closest('[data-lib-back]'))return closeLib();
        const t=e.target.closest('[data-filters-toggle]');if(t){const f=picker.querySelector('.sim-mech-filters');if(f){f.hidden=!f.hidden;t.setAttribute('aria-expanded',String(!f.hidden));}return;}
        if(e.target.closest('[data-filters-clear]')){for(const el of picker.querySelectorAll('[data-filter]'))if(el.type==='checkbox')el.checked=false;else el.value='';return refilter();}
        // A reference opens in the browser when the app can, else its link is copied: the app window never leaves Torque.
        const ref=e.target.closest('[data-m="ref"]');if(ref){const url=ref.dataset.v;if(!/^https:\/\//.test(url))return;if(root.deck?.openExternal)void root.deck.openExternal(url);else void navigator.clipboard?.writeText(url).then(()=>{ref.textContent='Copied';},()=>{ref.textContent=url;});return;}}
      const c=e.target.closest('button[data-pick-cat]');if(c){pickCat=c.dataset.pickCat;const q=picker.querySelector('[data-types-search]');if(q)q.value='';return refilter();}const r=e.target.closest('button[data-pick-src]');if(r){pickSrc=pickSrc===r.dataset.pickSrc?'':r.dataset.pickSrc;return refilter();}
      const b=e.target.closest('[data-m]');if(!b)return;if(b.dataset.m==='close')setPicking(false);else if(b.dataset.m==='add')add(b.dataset.v);});
    picker.addEventListener('input',e=>{if(e.target.matches('[data-types-search]')){closeLib();refilter();}});
    picker.addEventListener('change',e=>{if(e.target.matches('[data-filter]'))refilter();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&picking&&picker.isConnected)setPicking(false);});
    host.addEventListener('change',e=>{
      const el=e.target,id=el.closest('[data-mech]')?.dataset.mech;if(!id)return;const v=el.type==='number'?el.valueAsNumber:el.type==='checkbox'?el.checked:el.value;
      const row=el.closest('[data-state]')?.dataset.state;
      if(el.matches('[data-m-state-name]')){const name=String(v).trim().slice(0,24);if(!name||name===row)return;change(next=>{const j=jointOf(next,id);if(name in j.states)return false;j.states=Object.fromEntries(Object.entries(j.states).map(([k,x])=>[k===row?name:k,x]));});return;}
      if(el.dataset.mMore!==undefined){const name=String(v).trim();if(!/^[A-Za-z][\w .-]{0,39}$/.test(name)){status('A configuration name starts with a letter and uses letters, digits, spaces, _ . or -.');return;}change(next=>{const x=actOf(next,id)?.more?.[+el.dataset.mMore];if(!x)return false;x.device=name;});return;}
      if(el.dataset.mMoreRev!==undefined){change(next=>{const x=actOf(next,id)?.more?.[+el.dataset.mMoreRev];if(!x)return false;if(v)x.reversed=true;else delete x.reversed;});return;}
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
      if(f==='device2'){const name=String(v).trim();if(name&&!/^[A-Za-z][\w .-]{0,39}$/.test(name)){status('A configuration name starts with a letter and uses letters, digits, spaces, _ . or -.');return;}change(next=>{const a=actOf(next,id);if(!a)return false;if(name)a.device2=name;else{delete a.device2;delete a.reversed2;delete a.more;}});return;}
      if(f==='reversed2'){change(next=>{const a=actOf(next,id);if(v)a.reversed2=true;else delete a.reversed2;});return;}
      if(f==='reversed'){change(next=>{const a=actOf(next,id);if(v)a.reversed=true;else delete a.reversed;fitLimits(jointOf(next,id),a);});return;}
      if(['cpr','power'].includes(f)){if(!finite(v)||v<=0)return;change(next=>{actOf(next,id)[f]=f==='power'?Math.min(1,v):v;});return;}
      if(f==='speed'){if(!finite(v)||v<=0)return;change(next=>{const a=actOf(next,id);if(a)a.speed=v;else jointOf(next,id).speed=v;});return;}
    });
    return {render,open:({parent=null}={})=>setPicking(parent?true:!picking,parent),close:()=>setPicking(false),listed,adding:()=>picking?parentOf||'':null};
  }
  root.DeckMechanismList={create,GAME,AS_GAME};
})(typeof globalThis==='object'?globalThis:this);
