(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckRealRun=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Real run report (Calibrate → Real run): what the real robot did on the route Simulate planned, typed in by the
  // team pin by pin. Nothing here is measured or guessed by Torque: every value is what a person saw. The report is
  // saved as text and JSON so the difference between the simulated run and the real one can be read and acted on.
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const num=(k,label,max,step=1)=>({k,label,num:{max,step}}),pick=(k,label,opts)=>({k,label,opts});
  const RUN=[
    pick('where','Where it ran',['Home field','Practice field at an event','Match']),
    num('battery','Battery at the start (V)',15,.1),
    pick('start','Started on its spot',['Yes','A little off','Clearly off','Not sure']),
    pick('ended','How it ended',['Finished the route','Stopped part way','Ran out of time','Stopped by hand','Robot disconnected or crashed']),
    {k:'lastPin',label:'Last pin it reached',pins:true},
    num('time','Time it took (s)',200,.1),
    num('tips','Tips scored',20),
    num('scored','Pieces scored',200),
    num('penalties','Penalties',20),
  ];
  const MOVE=[
    pick('got','Got there',['On the spot','Stopped short','Went past','Off to its left','Off to its right','Hit something on the way','Never got there','Did not watch']),
    num('off','Off by (in)',144,.5),
    pick('facing','Facing',['Right way','Turned too far left','Turned too far right']),
    num('turn','Turned off by (°)',180),
    num('at','Got there at (s)',200,.1),
  ];
  const SHOOT=[
    num('made','Shots that scored',50),
    num('missed','Shots that missed',50),
    pick('miss','Misses went',['Short','Long','Left','Right','Bounced out','Hit the robot or the field','Did not fire','Mixed']),
    pick('speed','Shooter sounded',['Up to speed','Still spinning up','Slowed between shots']),
  ];
  const INTAKE=[
    num('picked','Pieces picked up',50),
    num('left','Pieces left behind',50),
    pick('why','Why they were left',['Robot stopped short of them','Robot pushed them away','Jammed in the intake','Dropped after pickup','Pieces were not there','Mixed']),
  ];
  const acts=p=>[...(p.steps||[]),...(p.path?.steps||[])].map(s=>String(s.action||'')).concat(String(p.action||''),String(p.path?.action||''));
  const shoots=p=>acts(p).some(a=>/shoot|score|launch/i.test(a)),intakes=p=>acts(p).some(a=>/intake|pick/i.test(a));
  // What the route asks for at a pin, in words: the path's actions on the way, then the pin's own.
  function asked(p){const say=list=>(list||[]).map(s=>s.action+(s.seconds!=null?` ${s.seconds} s`:'')).join(', '),way=say(p.path?.steps)||p.path?.action||'',here=say(p.steps)||p.action||'';
    return [way&&`on the way: ${way}`,here&&`at the pin: ${here}`].filter(Boolean).join(' · ')||'drive there';}
  const fields=p=>[...MOVE,...(shoots(p)?SHOOT:[]),...(intakes(p)?INTAKE:[])];
  const filled=v=>v!==''&&v!=null;
  const blank=()=>({run:{},pins:[],first:'',notes:''});
  // The report as text. Only what was entered is written; pins with nothing entered are listed, not padded out.
  function text(report,ctx){
    const pins=ctx.pins||[],lines=[`# Real run report: ${ctx.name||'robot'}`,'',`Written ${ctx.when||new Date().toLocaleString()}. Route of ${pins.length} pins${ctx.field?` on ${ctx.field}`:''}. Positions are inches from the field's corner; left and right are as the robot faces.`];
    if(ctx.sim)lines.push('',`The simulator said: ${ctx.sim}`);
    const line=(defs,src)=>defs.filter(d=>filled(src?.[d.k])).map(d=>`- ${d.label}: ${d.pins?'pin '+src[d.k]:src[d.k]}`);
    const run=line(RUN.filter(d=>d.k!=='tips'||ctx.tips!==false),report.run);
    lines.push('','## Whole run',...(run.length?run:['- Nothing entered.']));
    if(filled(report.first))lines.push(`- What went wrong first: ${report.first}`);
    if(filled(report.notes))lines.push(`- Anything else: ${report.notes}`);
    lines.push('','## Pin by pin');const empty=[];
    pins.forEach((p,i)=>{const r=report.pins[i]||{},got=line(fields(p),r);if(filled(r.note))got.push(`- Note: ${r.note}`);if(!got.length){empty.push(i+1);return;}
      lines.push('',`### Pin ${i+1} at (${(+p.x).toFixed(1)}, ${(+p.y).toFixed(1)}), ${asked(p)}`,...got);});
    if(empty.length)lines.push('',`Nothing entered for pin${empty.length>1?'s':''} ${empty.join(', ')}.`);
    return lines.join('\n')+'\n';
  }
  const control=(d,id,v,pins)=>{const at=`id="${id}" data-rr="${d.k}"`;
    if(d.pins)return `<select ${at}><option value=""></option>${pins.map((_,i)=>`<option${String(v)===String(i+1)?' selected':''}>${i+1}</option>`).join('')}</select>`;
    if(d.opts)return `<select ${at}><option value=""></option>${d.opts.map(o=>`<option${v===o?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
    return `<input ${at} type="number" data-slider="off" inputmode="decimal" min="0" max="${d.num.max}" step="${d.num.step}" value="${esc(v??'')}">`;};
  const field=(d,id,v,pins)=>`<label class="rr-f" for="${id}"><span>${esc(d.label)}</span>${control(d,id,v,pins)}</label>`;
  function create(o){
    const box=o.box;let report=blank(),key=null,told='';
    const ctx=()=>{const pins=o.pins()||[];return {pins,...o.context()};};
    const keep=()=>{try{o.store.set(JSON.stringify({key,report}));}catch{}};
    function load(k){key=k;report=blank();try{const got=JSON.parse(o.store.get()||'null');if(got?.key===k&&got.report)report={...blank(),...got.report,run:{...got.report.run},pins:Array.isArray(got.report.pins)?got.report.pins:[]};}catch{}}
    const say=t=>{told=t;const s=box.querySelector('[data-rr-status]');if(s)s.textContent=t;};
    function render(){
      const c=ctx(),pins=c.pins,runDefs=RUN.filter(d=>d.k!=='tips'||c.tips!==false);
      const head=`<section class="cal-card rr-card"><h2>Real run report</h2><p class="hint">After a run on the real robot, enter what it did. Fill in only what you saw; leave the rest blank. Left and right are as the robot faces. Save it and the report can be read back to correct the simulator and the route.</p>${c.sim?`<p class="hint rr-sim">The simulator said: ${esc(c.sim)}</p>`:''}
        <h3 class="cal-group-title">Whole run</h3><div class="rr-grid">${runDefs.map(d=>field(d,'rr-run-'+d.k,report.run[d.k],pins)).join('')}</div>
        <label class="rr-f rr-wide" for="rr-first"><span>What went wrong first</span><textarea id="rr-first" data-rr-text="first" rows="2">${esc(report.first)}</textarea></label>
        <label class="rr-f rr-wide" for="rr-notes"><span>Anything else</span><textarea id="rr-notes" data-rr-text="notes" rows="2">${esc(report.notes)}</textarea></label></section>`;
      const rows=pins.length?pins.map((p,i)=>{const r=report.pins[i]||{};return `<section class="cal-card rr-card rr-pin" data-rr-pin="${i}"><h2>Pin ${i+1}</h2><p class="hint">${esc(asked(p))}${p.note?` · ${esc(p.note)}`:''}</p><div class="rr-grid">${fields(p).map(d=>field(d,`rr-p${i}-${d.k}`,r[d.k],pins)).join('')}</div><label class="rr-f rr-wide" for="rr-p${i}-note"><span>Note</span><input id="rr-p${i}-note" data-rr="note" type="text" value="${esc(r.note??'')}"></label></section>`;}).join(''):'<section class="cal-card rr-card"><p class="hint">This setup has no route yet. Plan one in Simulate → Path planning, then come back.</p></section>';
      box.innerHTML=`${head}${rows}<div class="rr-bar"><p class="hint" data-rr-status role="status">${esc(told)}</p><div class="button-row"><button type="button" class="secondary" data-rr-act="clear">Start a new report</button><button type="button" class="secondary" data-rr-act="copy">Copy as text</button><button type="button" class="primary" data-rr-act="save">Save report</button></div></div>`;
    }
    box.addEventListener('input',e=>{const t=e.target;if(t.dataset.rrText){report[t.dataset.rrText]=t.value;keep();return;}if(!t.dataset.rr)return;
      const pin=t.closest('[data-rr-pin]'),into=pin?(report.pins[+pin.dataset.rrPin]||(report.pins[+pin.dataset.rrPin]={})):report.run;
      if(t.value==='')delete into[t.dataset.rr];else into[t.dataset.rr]=t.type==='number'?Number(t.value):t.value;
      for(let i=0;i<report.pins.length;i++)if(!report.pins[i])report.pins[i]={};keep();});
    box.addEventListener('click',async e=>{const b=e.target.closest('[data-rr-act]');if(!b)return;const act=b.dataset.rrAct,c={...ctx(),when:new Date().toLocaleString()},body=text(report,c);
      if(act==='clear'){report=blank();keep();told='';render();return;}
      if(act==='copy'){try{await o.copy(body);say('Copied. Paste it to Claude.');}catch{say('Could not copy. Save the report instead.');}return;}
      b.disabled=true;try{const r=await o.save({name:c.name||'robot',text:body,json:JSON.stringify({name:c.name,when:c.when,field:c.field||null,simulator:c.sim||null,pins:c.pins.map((p,i)=>({pin:i+1,x:p.x,y:p.y,asked:asked(p)})),report},null,1)});say(r?.file?`Saved to ${r.repo||r.file}`:'Could not save the report.');}
      catch(err){say('Could not save the report: '+err.message);}finally{b.disabled=false;}});
    return {
      // Draws the form for the setup and route now picked; what was typed stays unless the route changed.
      refresh(){const c=ctx(),k=`${c.id||''}|${c.pins.map(p=>`${(+p.x).toFixed(1)},${(+p.y).toFixed(1)}`).join(';')}`;if(k===key&&box.firstChild)return;load(k);render();},
      report:()=>report,
    };
  }
  return {create,text,blank,asked,shoots,intakes};
});
