(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckSimSteps=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // The list of steps a path runs while it is driven (together) or a pin runs once the robot is there (one after
  // another): what the editor offers for this setup, how a step reads in words, and the editor itself.
  const finite=n=>typeof n==='number'&&Number.isFinite(n),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const Mech=()=>globalThis.DeckMechanisms||require('./sim-mechanisms.js');
  const INFO={Intake:'Runs the intake rollers. At a pin it runs for the time set; with no time it stays on for the steps after it, so “Intake, Shoot for 2 s” shoots while intaking. While driving it runs for the whole path or the time set, and a Shoot on the same path shoots each piece as it comes in. A ramp stays where it is.',
    'Ramp down':'Folds the ramp down. It stays down until a Ramp up step, and while it is down the intake reaches into a flower for its pollen.',
    'Ramp up':'Folds the ramp back up. The rollers still take pieces off the floor.',
    Shoot:'Spins up, aims and shoots every piece it holds, or a set number. At a pin, the robot waits there until the shots are done.',
    'Spin up':'Starts the flywheel early, so a later Shoot fires right away. It keeps spinning until that Shoot.',
    Aim:'Turns the turret toward the hive, so a later Shoot does not wait for it.',
    Turret:'Turns the turret to an angle from the robot’s front (+ left, − right). At a pin the robot waits until it is there.',
    Wait:'At a pin, waits a set time before the next step. While driving, it does nothing.',
    part:'Moves this part of your robot (Setup → Mechanisms → Moving parts). At a pin, the robot waits until it gets there.',
    own:'Your own action. The export adds a method with this name for your code, and it runs for the time you set (or finishes at once).'};
  // What can be added for this setup: only what the robot has parts for. Intake needs an intake, Ramp down and Ramp up a
  // ramp, Spin up and Shoot a shooter, Aim and Turret angle a turret (Setup → Mechanisms); then moving parts with their
  // named positions, the setup's saved part actions, Wait, and the team's own named actions. A robot with no
  // mechanisms is offered none of the game's actions.
  function catalog({field='empty',mechanisms=null,kinematics=null}={}){
    const M=Mech(),m=mechanisms?M.sanitize(mechanisms):null,on=!!m?.enabled,game=field==='biobuzz'&&on?M.actions(m):[];
    const own=on?m.shooters.map((s,n)=>s.type==='turret'&&!s.sharesTurret?n:-1).filter(n=>n>=0):[];
    const turrets=field!=='biobuzz'||!own.length?[]:own.length===1?[{turret:null,label:'Turret'}]:[{turret:null,label:'Both turrets'},...own.map(n=>({turret:n,label:`Turret ${n+1}`}))];
    const k=kinematics||{joints:[],actions:[]},parts=(k.joints||[]).filter(j=>j.drive?.signal==='action'&&['revolute','prismatic','continuous'].includes(j.type||'revolute')).map(j=>({name:j.name,states:Object.keys(j.states||{}),unit:j.type==='prismatic'?'in':'°',lower:finite(j.lower)?j.lower:null,upper:finite(j.upper)?j.upper:null}));
    return {game,turrets,parts,saved:(k.actions||[]).map(a=>a.name).filter(Boolean),turretRange:on?[m.turret.min,m.turret.max]:[-180,180]};
  }
  // What a step is, from its name: a game action, a turret angle, a part to a position or an angle, a saved action, a wait or the team's own.
  function kindOf(name,cat){const M=Mech(),a=M.action(name),text=String(name||'').trim();
    if(/^wait$/i.test(text))return {type:'wait'};
    if(a.kind==='turret')return {type:'turret',turret:a.turret,degrees:a.degrees};
    if(a.kind==='shoot')return {type:'shoot',count:a.count};
    if(a.kind!=='custom'&&a.kind!=='none')return {type:'game',label:cat.game.find(g=>g.toLowerCase()===text.toLowerCase())||text};
    for(const p of cat.parts){const own=p.name.toLowerCase();if(!text.toLowerCase().startsWith(own+' '))continue;const rest=text.slice(own.length+1).trim(),to=/^to\s+(-?\d+(?:\.\d+)?)\s*(?:°|deg|in)?$/i.exec(rest);
      if(to)return {type:'part',part:p,value:Number(to[1])};const state=p.states.find(s=>s.toLowerCase()===rest.toLowerCase());if(state)return {type:'part',part:p,state};}
    if(cat.saved.some(s=>s.toLowerCase()===text.toLowerCase()))return {type:'saved'};
    return {type:'own'};}
  const round=v=>+(+v).toFixed(2);
  const partName=(p,{state,value})=>state!==undefined?`${p.name} ${state}`:`${p.name} to ${round(value)}${p.unit==='in'?' in':'°'}`;
  // Which steps have no time of their own: Spin up starts and goes on at once.
  const instant=name=>/^spin\s*up$/i.test(String(name||'').trim());
  // A step in words: "Intake for 1 s", "Shoot 2 (other cell)", "Turret to 30°", "Wait 0.5 s".
  function describe(s,where='pin'){const t=finite(s.seconds),aims=/^(shoot|aim)\b/i.test(s.action);
    if(/^wait$/i.test(s.action))return `Wait${t?' '+round(s.seconds)+' s':''}`;
    if(where==='pin'&&!t&&/^intake$/i.test(s.action))return 'Intake on';
    return `${s.action}${aims&&s.cell==='other'?' (other cell)':''}${t?` for ${round(s.seconds)} s`:''}`;}
  // A whole list in words: "Shoot → Ramp down → Intake for 1 s" (a pin) or "Intake + Ramp down" (a path).
  const summary=(steps,where='pin')=>(steps||[]).map(s=>describe(s,where)).join(where==='path'?' + ':' → ');
  // A new step, with the time it needs: an Intake at a pin runs for a time (1 s to start), others until done.
  const fresh=(action,where)=>({action,seconds:where==='pin'&&/^intake$/i.test(action)?1:/^wait$/i.test(action)?.5:null,cell:'start'});

  // The editor: renders steps into host and calls onChange(steps) after every change. id: a prefix for its elements'
  // ids (focus survives the host rebuilding it). where: 'pin' (one after another) or 'path' (together while driving).
  function editor(host,{steps=[],where='pin',catalog:cat,onChange=()=>{},id='steps',biobuzz=false}){
    const list=steps.map(s=>({action:s.action,seconds:finite(s.seconds)?s.seconds:null,cell:s.cell==='other'?'other':'start'})),pin=where==='pin';
    const save=()=>onChange(list.map(s=>({...s})));
    const add=s=>{list.push(s);save();render(`${id}-${list.length-1}-what`);};
    function row(s,i){const k=kindOf(s.action,cat),n=i+1,label=`step ${n}`;let what;
      if(k.type==='turret'){const choices=cat.turrets.length?cat.turrets:[{turret:null,label:'Turret'}];
        what=`<span class="sim-step-name" title="${esc(INFO.Turret)}">Turret</span>${choices.length>1?`<select id="${id}-${i}-what" class="sim-step-pick" aria-label="Which turret, ${label}">${choices.map(c=>`<option value="${c.turret??''}"${(c.turret??null)===(k.turret??null)?' selected':''}>${c.turret===null?'all':c.turret+1}</option>`).join('')}</select>`:`<span id="${id}-${i}-what" tabindex="-1"></span>`}<span class="sim-step-word">to</span><input id="${id}-${i}-deg" class="sim-step-num" type="number" step="any" min="${cat.turretRange[0]}" max="${cat.turretRange[1]}" value="${round(k.degrees)}" aria-label="Turret angle in degrees, ${label}"><span class="sim-step-unit">°</span>`;}
      else if(k.type==='part'){const p=k.part,angle=k.state===undefined;
        what=`<span class="sim-step-name" title="${esc(INFO.part)}">${esc(p.name)}</span><select id="${id}-${i}-what" class="sim-step-pick" aria-label="${esc(p.name)} position, ${label}">${p.states.map(st=>`<option value="${esc(st)}"${st===k.state?' selected':''}>${esc(st)}</option>`).join('')}<option value=""${angle?' selected':''}>to ${p.unit==='in'?'a length':'an angle'}…</option></select>${angle?`<input id="${id}-${i}-deg" class="sim-step-num" type="number" step="any"${p.lower!==null?` min="${p.lower}"`:''}${p.upper!==null?` max="${p.upper}"`:''} value="${round(k.value)}" aria-label="${esc(p.name)} ${p.unit==='in'?'inches':'degrees'}, ${label}"><span class="sim-step-unit">${p.unit}</span>`:''}`;}
      else if(k.type==='shoot')what=`<span class="sim-step-name" id="${id}-${i}-what" tabindex="-1" title="${esc(INFO.Shoot)}">Shoot</span><select id="${id}-${i}-count" class="sim-step-pick" aria-label="How many shots, ${label}"><option value="0"${!k.count?' selected':''}>all</option>${[1,2,3,4].map(c=>`<option value="${c}"${k.count===c?' selected':''}>${c}</option>`).join('')}</select>`;
      else if(k.type==='own')what=`<input id="${id}-${i}-what" class="sim-step-own" maxlength="40" value="${esc(s.action)}" aria-label="Action name, ${label}" title="${esc(INFO.own)}">`;
      else what=`<span class="sim-step-name" id="${id}-${i}-what" tabindex="-1" title="${esc(INFO[k.type==='wait'?'Wait':k.label]||INFO.part)}">${esc(k.type==='wait'?'Wait':s.action)}</span>`;
      const timed=!instant(s.action),needs=pin&&k.type==='wait',stays=pin&&/^intake$/i.test(s.action);
      const time=timed?`<span class="sim-step-time"><input id="${id}-${i}-secs" class="sim-step-num" type="number" min="0.05" max="30" step="any" value="${finite(s.seconds)?round(s.seconds):''}" placeholder="${needs?'1':stays?'on':pin?'done':'path'}" title="Seconds. Empty: ${stays?'it stays on for the steps after it, so a Shoot after it shoots while intaking':pin?'until it is done':'the whole path'}" aria-label="Seconds, ${label}"${needs?' required':''}><span class="sim-step-unit">s</span></span>`:'<span class="sim-step-time hint">at once</span>';
      const cell=biobuzz&&/^(shoot|aim)\b/i.test(s.action)?`<button type="button" class="sim-chip sim-step-cell" id="${id}-${i}-cell" aria-pressed="${s.cell==='other'}" title="Aim at the hive cell up at the start, or the other cell (up after the first tip)">${s.cell==='other'?'Other cell':'Start cell'}</button>`:'';
      return `<li class="sim-step" data-i="${i}"><span class="sim-step-n" aria-hidden="true">${pin?n:'+'}</span><span class="sim-step-what">${what}</span>${time}${cell}<span class="sim-step-tools"><button type="button" class="icon-button" data-step-move="-1" aria-label="Move ${label} up"${i===0?' disabled':''}>↑</button><button type="button" class="icon-button" data-step-move="1" aria-label="Move ${label} down"${i===list.length-1?' disabled':''}>↓</button><button type="button" class="icon-button" data-step-remove aria-label="Remove ${label}">×</button></span></li>`;}
    function render(focus){
      const full=list.length>=8,partOptions=cat.parts.map(p=>`<optgroup label="${esc(p.name)}">${p.states.map(st=>`<option value="${esc(p.name+' '+st)}">${esc(p.name+' '+st)}</option>`).join('')}<option value="to:${esc(p.name)}">${esc(p.name)} to ${p.unit==='in'?'a length':'an angle'}…</option></optgroup>`).join('')+(cat.saved.length?`<optgroup label="Saved actions">${cat.saved.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('')}</optgroup>`:'');
      host.innerHTML=`<ol class="sim-steps-list" aria-label="${pin?'Steps at this pin, in order':'Steps while driving'}">${list.map(row).join('')}</ol>
        ${list.length?'':`<p class="hint sim-steps-empty">${pin?'Nothing here: the robot drives on.':'Nothing: the robot just drives.'}</p>`}
        <div class="sim-steps-add" role="group" aria-label="Add a step">${[...cat.game.map(g=>`<button type="button" class="sim-chip" data-step-add="${esc(g)}" title="${esc(INFO[g]||'')}"${full?' disabled':''}>+ ${esc(g)}</button>`),
          ...(cat.turrets.length?[`<button type="button" class="sim-chip" data-step-turret="" title="${esc(INFO.Turret)}"${full?' disabled':''}>+ Turret angle</button>`]:[]),
          ...(pin?[`<button type="button" class="sim-chip" data-step-add="Wait" title="${esc(INFO.Wait)}"${full?' disabled':''}>+ Wait</button>`]:[]),
          `<button type="button" class="sim-chip" data-step-own title="${esc(INFO.own)}"${full?' disabled':''}>+ Your own…</button>`].join('')}
          ${partOptions?`<select class="sim-step-parts" id="${id}-parts" aria-label="Add a moving part step"${full?' disabled':''}><option value="">+ Moving part…</option>${partOptions}</select>`:''}</div>
        <p class="hint sim-steps-hint">${full?'8 steps at most. ':''}${pin?'Steps run top to bottom, each once the one before is done. Seconds: how long a step runs; empty runs it until it is done.':'Steps run together from the start of the path. Seconds: how long a step runs; empty runs it for the whole path.'}</p>`;
      wire();if(focus)(document.getElementById(focus)||host.querySelector('[data-step-add]'))?.focus({preventScroll:true});}
    function wire(){const q=s=>host.querySelector(s);
      for(const li of host.querySelectorAll('.sim-step')){const i=+li.dataset.i,s=list[i],k=kindOf(s.action,cat),el=x=>li.querySelector(`#${id}-${i}-${x}`);
        li.querySelector('[data-step-remove]').onclick=()=>{list.splice(i,1);save();render(list.length?`${id}-${Math.min(i,list.length-1)}-what`:`${id}-parts`);};
        for(const b of li.querySelectorAll('[data-step-move]'))b.onclick=()=>{const j=i+Number(b.dataset.stepMove);if(!list[j])return;[list[i],list[j]]=[list[j],list[i]];save();render(`${id}-${j}-what`);};
        const secs=el('secs');if(secs)secs.onchange=e=>{const raw=e.target.value.trim(),v=e.target.valueAsNumber;
          if(raw===''){if(e.target.required){e.target.value=round(s.seconds??1);return;}s.seconds=null;return save();}
          if(!finite(v)||v<.05||v>30){e.target.setCustomValidity('Enter 0.05 to 30 seconds, or leave it empty.');e.target.reportValidity();return;}e.target.setCustomValidity('');s.seconds=v;save();};
        const cell=el('cell');if(cell)cell.onclick=()=>{s.cell=s.cell==='other'?'start':'other';save();render(`${id}-${i}-cell`);};
        if(k.type==='turret'){const name=()=>{const pick=el('what')?.tagName==='SELECT'?el('what').value:'',deg=el('deg').valueAsNumber;s.action=Mech().turretAction(finite(deg)?deg:0,pick===''?null:Number(pick));save();};
          el('deg').onchange=e=>{const [lo,hi]=cat.turretRange,v=e.target.valueAsNumber;if(!finite(v)||v<lo||v>hi){e.target.setCustomValidity(`Enter ${lo} to ${hi} degrees.`);e.target.reportValidity();return;}e.target.setCustomValidity('');name();};
          if(el('what')?.tagName==='SELECT')el('what').onchange=name;}
        if(k.type==='part'){const p=k.part;el('what').onchange=e=>{s.action=e.target.value?partName(p,{state:e.target.value}):partName(p,{value:k.value??(p.lower!==null&&p.lower>0?p.lower:0)});save();render(`${id}-${i}-${e.target.value?'what':'deg'}`);};
          if(el('deg'))el('deg').onchange=e=>{const v=e.target.valueAsNumber;if(!finite(v)||p.lower!==null&&v<p.lower||p.upper!==null&&v>p.upper){e.target.setCustomValidity(`Enter a value${p.lower!==null?' from '+p.lower:''}${p.upper!==null?' to '+p.upper:''}.`);e.target.reportValidity();return;}e.target.setCustomValidity('');s.action=partName(p,{value:v});save();};}
        if(k.type==='shoot')el('count').onchange=e=>{s.action=+e.target.value?`Shoot ${e.target.value}`:'Shoot';save();};
        if(k.type==='own')el('what').onchange=e=>{const v=e.target.value.replace(/[→+]/g,' ').trim().slice(0,40);if(!v){e.target.setCustomValidity('Name the action, or remove the step.');e.target.reportValidity();return;}e.target.setCustomValidity('');s.action=v;save();render(`${id}-${i}-secs`);};}
      for(const b of host.querySelectorAll('[data-step-add]'))b.onclick=()=>add(fresh(b.dataset.stepAdd,where));
      for(const b of host.querySelectorAll('[data-step-turret]'))b.onclick=()=>add(fresh(Mech().turretAction(0,b.dataset.stepTurret===''?null:Number(b.dataset.stepTurret)),where));
      q('[data-step-own]').onclick=()=>{list.push({action:'My action',seconds:null,cell:'start'});save();render(`${id}-${list.length-1}-what`);const input=document.getElementById(`${id}-${list.length-1}-what`);input?.select?.();};
      const parts=q('.sim-step-parts');if(parts)parts.onchange=e=>{const v=e.target.value;if(!v)return;const to=v.startsWith('to:'),p=to?cat.parts.find(x=>x.name===v.slice(3)):null;
        add(fresh(p?partName(p,{value:p.lower!==null&&p.lower>0?p.lower:0}):v,where));};}
    render();
    return {focus:()=>host.querySelector('input,select,button')?.focus({preventScroll:true}),steps:()=>list.map(s=>({...s}))};
  }
  return {INFO,catalog,kindOf,describe,summary,fresh,editor};
});
