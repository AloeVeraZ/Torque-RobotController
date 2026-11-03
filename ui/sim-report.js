(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckSimReport=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Run report: answers "did my autonomous work, how long did it take, where did the time go and what
  // should I change next" from the frames the run recorded. Nothing here is estimated or invented:
  // every number comes from the simulated run, and the report says so.
  const finite=n=>typeof n==='number'&&Number.isFinite(n),s1=n=>`${n.toFixed(1)} s`;
  // Which leg (one per route path) a frame belongs to: the route program reports "leg N of M",
  // timed driving reports the segment it is on. Other programs (team Java) have no legs.
  function legOf(f){
    const m=/^(\d+) of (\d+)$/.exec(String(f.telemetry?.leg??f.telemetry?.Leg??''));if(m)return {index:Number(m[1])-1,count:Number(m[2])};
    if(f.execution==='timed'&&finite(f.follower?.pathIndex))return {index:f.follower.pathIndex,count:null};return null;
  }
  // The mechanism action a frame is running, if any: a pin's pause, an action path, or the mechanism commands.
  function action(f){const c=f.mechanisms?.command||{};return f.wait?.action||f.acting||(c.feed?'Shoot':c.intake?'Intake':c.spin||c.aim?'Spin up and aim':'');}
  // What the robot was doing during a frame: driving, turning in place, stopped for a pause or an
  // action (intaking, spinning up, shooting), or stopped with nothing running.
  function activity(f){
    const t=f.truth||{};if(Math.hypot(t.vx||0,t.vy||0)>1)return 'drive';if(Math.abs(t.omega||0)>10)return 'turn';
    return f.wait||action(f)?'pause':'idle';
  }
  const contactKind=id=>id==='field-wall'?'wall':/^(field|goal)-/.test(id)?'field':'zone';
  const KIND={wall:'the field wall',field:'a field structure',zone:'a no-go zone'};
  // frames: recorded run frames. ctx: {pins:[{x,y,path:{power}}], defaultPower, autoSeconds, optimized, whole}.
  // Without `whole` the report covers the route, and a run with no route result has none; with it the report covers
  // every frame, which is how teleop, driven by hand and with no result, is reported.
  function build(frames,ctx={}){
    const found=[...frames].reverse().find(f=>f.result)?.result;if(!frames.length||!found&&!ctx.whole)return null;
    const driven=!found,lastFrame=frames.at(-1),end=found||{time:lastFrame.time,violations:lastFrame.violations};
    const pins=ctx.pins||[],t0=frames[0].time,stop=ctx.whole?lastFrame.time:end.time,run=frames.filter(f=>f.time<=stop+1e-6),total=Math.max(0,stop-t0);
    // Time per leg, split by activity.
    const legs=[],blank=i=>({index:i,drive:0,turn:0,pause:0,idle:0,total:0,start:null,actions:new Set()});let count=null,before=0;
    for(let i=0;i<run.length;i++){
      const f=run[i],next=run[i+1]?.time??stop,dt=Math.max(0,next-f.time),leg=legOf(f);if(!dt)continue;
      if(!leg){before+=dt;continue;}if(leg.count)count=leg.count;
      const l=legs[leg.index]||=blank(leg.index);l[activity(f)]+=dt;l.total+=dt;if(l.start===null)l.start=f.time-t0;const act=activity(f)==='pause'&&action(f);if(act)l.actions.add(act);
    }
    // Paths are numbered like the planner's list only when every leg is one of its paths.
    const editable=count===pins.length;
    const out=legs.filter(Boolean).map(l=>({...l,actions:[...l.actions],label:`${editable?'Path':'Leg'} ${l.index+1}`,pin:editable?l.index:null}));
    // Contacts that started during the run. Robots usually start against the wall, so contact made
    // before the robot has moved an inch from its start pose is where it was placed, not the route.
    const contacts=[],home=frames[0].truth,moved=f=>home&&f.truth&&Math.hypot(f.truth.x-home.x,f.truth.y-home.y)>1;let prev=new Set([...(frames[0].contacts||[]),...(frames[0].hit||[])]),away=false;
    for(const f of run){const now=new Set([...(f.contacts||[]),...(f.hit||[])]);away||=moved(f);for(const id of now)if(!prev.has(id)&&away){const leg=legOf(f);contacts.push({id,kind:contactKind(id),time:f.time-t0,pin:editable&&leg?leg.index:null,label:leg?`${editable?'Path':'Leg'} ${leg.index+1}`:driven?'teleop':'the start'});}prev=now;}
    const last=pins.at(-1),endError=last&&end.truth&&['route','timed'].includes(end.kind)?Math.hypot(end.truth.x-last.x,end.truth.y-last.y):null;
    const estimateError=end.estimate&&end.truth?Math.hypot(end.estimate.x-end.truth.x,end.estimate.y-end.truth.y):null;
    const zones=end.violations?.length||0,mech=[...run].reverse().find(f=>f.mechanisms)?.mechanisms||null;
    const timedOut=end.reason==='time-limit',auto=finite(ctx.autoSeconds)?ctx.autoSeconds:null;
    // Things that went wrong, each tied to the path where it happened.
    const issues=[];const grouped=new Map();for(const c of contacts){const key=c.kind+'|'+c.label;if(!grouped.has(key))grouped.set(key,c);}
    for(const c of grouped.values())issues.push({level:c.kind==='wall'?'warn':'bad',pin:c.pin,text:`Touched ${KIND[c.kind]} during ${c.label} at ${s1(c.time)}.`});
    if(finite(endError)&&endError>2)issues.push({level:'warn',pin:editable&&pins.length?pins.length-1:null,text:`Stopped ${endError.toFixed(1)} in away from the last path’s end point.`});
    // Suggestions, most useful first. Each names what the run measured.
    const tips=[];
    if(timedOut){const at=out.at(-1);tips.push({pin:at?.pin??null,text:`The route needs more than the ${auto??'autonomous'}${auto?' s':''} period${at?` (it was on ${at.label})`:''}. Remove a path, shorten pauses or raise motor power.`});}
    if(grouped.size&&!driven)tips.push({pin:[...grouped.values()][0].pin,text:'Move that path’s points away from what it touched, or raise “Space around obstacles” in Path planning → Route options.',setting:'clearance'});
    const slow=out.length>1?out.reduce((a,b)=>b.total>a.total?b:a):null;
    if(slow&&total>0){const parts=[slow.pause>.05&&`${s1(slow.pause)} stopped for ${slow.actions.length?slow.actions.join(', ').toLowerCase():'a pause'}`,slow.turn>.05&&`${s1(slow.turn)} turning in place`,slow.idle>.2&&`${s1(slow.idle)} stopped`].filter(Boolean);
      tips.push({pin:slow.pin,text:`${slow.label} takes the longest: ${s1(slow.total)} of ${s1(total)}${parts.length?`, including ${parts.join(' and ')}`:''}. Changes there save the most time.`});}
    const sum=k=>out.reduce((a,l)=>a+l[k],0),pause=sum('pause'),turn=sum('turn');
    if(total>0&&pause/total>.2){const most=out.reduce((a,b)=>b.pause>a.pause?b:a);tips.push({pin:most.pin,text:`The robot spends ${s1(pause)} stopped for pauses and actions. Shorten a pause if its mechanism finishes sooner, or run the action while driving (most is in ${most.label}).`});}
    if(total>0&&turn/total>.15){const most=out.reduce((a,b)=>b.turn>a.turn?b:a);tips.push({pin:most.pin,text:`Turning in place takes ${s1(turn)}. If the robot does not need that heading, letting it keep its heading or turn while driving saves time (most is in ${most.label}).`});}
    const def=finite(ctx.defaultPower)?ctx.defaultPower:1;
    for(const l of out){const power=pins[l.index]?.path?.power??def;if(l.pin!==null&&power<.75&&l.drive>=1){tips.push({pin:l.pin,text:`${l.label} drives at ${Math.round(power*100)}% motor power for ${s1(l.drive)}. If your robot stays in control, more power would shorten it.`});break;}}
    if(mech&&mech.shots>mech.landed)tips.push({pin:null,text:`${mech.shots-mech.landed} of ${mech.shots} shot${mech.shots>1?'s':''} missed the hive. Drag the timeline to replay each shot and see where it went.`});
    if(ctx.optimized===false&&out.length>1)tips.push({pin:null,setting:'optimize',text:'Optimize (Path planning → Route options) test-drives straight and smooth shapes for your paths and keeps the fastest safe one.'});
    if(!timedOut&&!issues.length&&auto&&auto-total>5)tips.push({pin:null,text:`${s1(auto-total)} of the autonomous period is left: room for another path or more scoring.`});
    const level=timedOut?'bad':issues.some(i=>i.level==='bad')?'bad':issues.length?'warn':'ok';
    const title=driven?`Teleop ran for ${s1(total)}${issues.length?`, with ${issues.length} thing${issues.length>1?'s':''} to check`:''}`:timedOut?'Autonomous ended before the route finished':issues.length?`Route finished in ${s1(total)}, with ${issues.length} thing${issues.length>1?'s':''} to check`:`Route finished cleanly in ${s1(total)}`;
    const facts=[['Time',auto?`${s1(total)} of the ${auto} s autonomous${timedOut?'':` · ${s1(Math.max(0,auto-total))} to spare`}`:s1(total),timedOut?'bad':'']];
    if(finite(endError))facts.push(['Final position',`${endError.toFixed(1)} in from the last end point`,endError>2?'warn':'']);
    if(finite(estimateError))facts.push(['Position tracking',`the robot’s own estimate was ${estimateError.toFixed(1)} in off at the end`,estimateError>2?'warn':'','Sensor estimate: how far the position the robot worked out from its odometry and IMU was from where it really was, at the end of the route. Large values mean its sensors or their offsets need checking.']);
    facts.push(['Contact',contacts.length?[...new Set(contacts.map(c=>KIND[c.kind]))].join(', '):'None',contacts.some(c=>c.kind!=='wall')||zones?'bad':contacts.length?'warn':'']);
    if(mech&&finite(mech.score))facts.push(['Points',`${mech.score}${mech.shots?` · ${mech.landed} of ${mech.shots} shots landed`:''}`,'']);
    // A full match's report is about its route; the points go on through teleop.
    const matchScore=lastFrame.mechanisms?.score;if(!driven&&lastFrame.time>stop&&finite(matchScore)&&frames.some(f=>f.practice?.phase==='teleop'))facts.push(['Full match points',String(matchScore),'']);
    return {level,title,total,before,auto,legs:out,contacts,issues,tips:tips.slice(0,3),facts,endError,estimateError,timedOut,driven};
  }

  // ------------------------------------------------------------------ drawing
  // grow sets flex-grow through the CSSOM: the app's content security policy ignores style attributes.
  const el=(tag,attrs={},children=[])=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(attrs))k==='text'?e.textContent=v:k==='grow'?e.style.flexGrow=String(v):k.startsWith('on')?e[k]=v:e.setAttribute(k,v);e.append(...children);return e;};
  // Settings a tip can open: onSetting(key) shows it in Path planning → Route options.
  const SETTINGS={clearance:'Space around obstacles',optimize:'Optimize'};
  const editButton=(pin,label,onEdit)=>el('button',{type:'button',class:'text-button sim-report-edit',onclick:()=>onEdit(pin),text:`Edit ${label} →`});
  // What to do after this run, most likely first: fix the path where something went wrong, or take a clean
  // run to the robot. Each action is {id, label, run}; the page supplies what they do.
  function nextSteps(report,{onEdit,onExport,onOutput}={}){
    const fix=report.issues.find(i=>i.pin!==null)||(report.timedOut&&report.tips.find(t=>t.pin!==null));
    const steps=[];
    if(report.level!=='ok'&&fix&&onEdit)steps.push({id:'fix',label:`Fix path ${fix.pin+1} →`,primary:true,run:()=>onEdit(fix.pin)});
    if(onExport&&!report.driven)steps.push({id:'export',label:'Export to your robot →',primary:report.level==='ok',run:onExport});
    if(onOutput)steps.push({id:'output',label:'See each step',primary:false,run:onOutput});
    return steps;
  }
  // report: from build(). onEdit(pinIndex) opens that path in Path planning; onSeek(seconds) replays a moment;
  // onExport and onOutput open the Export view and the run's step-by-step output; onSetting(key) opens a setting a tip names; onSelect(leg) is told which
  // path's breakdown is shown, and selected (a leg index) keeps that choice when the report is drawn again.
  function render(host,report,{onEdit,onSeek,onExport,onOutput,onSelect,onSetting,selected=null}={}){
    if(!report){host.replaceChildren();return;}
    const icon={ok:'✓',warn:'!',bad:'×'}[report.level];
    const head=el('div',{class:'sim-report-verdict '+report.level},[el('span',{class:'sim-report-icon','aria-hidden':'true',text:icon}),el('strong',{text:report.title})]);
    const facts=el('dl',{class:'sim-analysis-list sim-report-facts'},report.facts.flatMap(([k,v,l,about])=>[el('dt',about?{text:k,title:about}:{text:k}),el('dd',{text:v,class:l||''})]));
    const parts=[head,facts],steps=nextSteps(report,{onEdit,onExport,onOutput}),fixPin=steps.find(s=>s.id==='fix')?report.issues.find(i=>i.pin!==null)?.pin:null;
    // An issue's own Edit link is left out when the Fix button below already opens that path.
    if(report.issues.length)parts.push(el('ul',{class:'sim-report-issues'},report.issues.map(i=>el('li',{class:i.level},[el('span',{text:i.text}),...(i.pin!==null&&i.pin!==fixPin&&onEdit?[editButton(i.pin,`path ${i.pin+1}`,onEdit)]:[])]))));
    if(steps.length)parts.push(el('div',{class:'sim-report-next',role:'group','aria-label':'Next step'},steps.map(s=>el('button',{type:'button',class:s.primary?'primary':'secondary','data-next':s.id,onclick:s.run,text:s.label}))));
    // Where the time went, on the autonomous period's own scale: a segment per path, its width its share of the
    // period, split into driving, turning in place, stopped for an action and stopped idle, then the time left.
    // One path is chosen (the longest, until another is clicked): its breakdown shows under the bar and
    // onSelect(leg) marks it on the field. Clicking a path also replays its start.
    if(report.legs.length&&report.total>0){
      const span=report.auto&&!report.timedOut&&report.total<report.auto?report.auto:report.total,buttons=[],detail=el('div',{class:'sim-report-leg-detail','aria-live':'polite'});
      const bar=el('div',{class:'sim-report-bar',role:'group','aria-label':span===report.auto?`Time per path in the ${report.auto} s autonomous`:'Time per path'});
      if(report.before>.05)bar.append(el('span',{class:'sim-report-gap',grow:report.before,title:`Starting up: ${report.before.toFixed(1)} s`}));
      const choose=(l,replay)=>{for(const b of buttons)b.setAttribute('aria-pressed',String(b.leg===l));
        const kinds=[['drive','Driving'],['turn','Turning in place'],['pause',l.actions.length?`Stopped for ${l.actions.join(', ')}`:'Paused'],['idle','Stopped, nothing running']].filter(([k])=>l[k]>.05);
        detail.replaceChildren(el('p',{class:'sim-report-leg-title'},[el('strong',{text:`${l.label} · ${l.total.toFixed(1)} s`}),document.createTextNode(` · from ${l.start.toFixed(1)} s to ${(l.start+l.total).toFixed(1)} s`)]),
          el('ul',{class:'sim-report-leg-parts'},kinds.map(([k,t])=>el('li',{},[el('i',{class:k}),document.createTextNode(`${t} ${l[k].toFixed(1)} s`)]))),
          ...(l.pin!==null&&onEdit?[editButton(l.pin,`path ${l.pin+1}`,onEdit)]:[]));
        onSelect?.(l);if(replay)onSeek?.(l.start);};
      for(const l of report.legs){const seg=el('button',{type:'button',class:'sim-report-leg',grow:Math.max(.001,l.total),'aria-pressed':'false',title:`${l.label}: ${l.total.toFixed(2)} s · driving ${l.drive.toFixed(2)} s · turning ${l.turn.toFixed(2)} s · actions and pauses ${l.pause.toFixed(2)} s${l.idle>.005?` · stopped ${l.idle.toFixed(2)} s`:''}. Click to replay.`,'aria-label':`${l.label}, ${l.total.toFixed(1)} seconds. Show its breakdown and replay it on the field.`,onclick:()=>choose(l,true)},
          [el('span',{class:'sim-report-mix'},['drive','turn','pause','idle'].filter(k=>l[k]>0).map(k=>el('i',{class:k,grow:l[k]}))),el('span',{class:'sim-report-label',text:String(l.index+1)})]);seg.leg=l;buttons.push(seg);bar.append(seg);}
      const spare=span-report.total;if(spare>.05)bar.append(el('span',{class:'sim-report-spare',grow:spare,title:`${spare.toFixed(2)} s of the autonomous left`},[el('span',{text:`${spare.toFixed(1)} s spare`})]));
      // Seconds under the bar: every 5 s up to 30 s, every 10 s beyond.
      const step=span>30?10:5,scale=el('div',{class:'sim-report-scale','aria-hidden':'true'});
      for(let t=0;t<=span+1e-6;t+=step){const tick=el('span',{text:`${t}`});tick.style.left=`${t/span*100}%`;scale.append(tick);}
      if(span%step>1e-6){const end=el('span',{class:'end',text:`${+span.toFixed(1)}`});end.style.left='100%';scale.append(end);}
      const key=el('p',{class:'sim-report-key'},[['drive','Driving','Driving'],['turn','Turning','Turning in place'],['pause','Action or pause','Stopped for an action or a pause'],['idle','Idle','Stopped with nothing running']].map(([k,t,long])=>el('span',{title:long},[el('i',{class:k}),document.createTextNode(t)])));
      parts.push(el('h4',{text:`Where the time went${span===report.auto?` · ${report.auto} s autonomous`:''}`}),bar,scale,key,detail);
      choose(report.legs.find(l=>l.index===selected)||report.legs.reduce((a,b)=>b.total>a.total?b:a),false);
    }
    if(report.tips.length)parts.push(el('h4',{text:'What to try next'}),el('ol',{class:'sim-report-tips'},report.tips.map(t=>el('li',{},[el('span',{text:t.text}),...(t.pin!==null&&onEdit?[editButton(t.pin,`path ${t.pin+1}`,onEdit)]:[]),...(t.setting&&onSetting?[el('button',{type:'button',class:'text-button sim-report-edit','data-setting':t.setting,onclick:()=>onSetting(t.setting),text:`Open ${SETTINGS[t.setting]} →`})]:[])]))));
    parts.push(el('p',{class:'hint sim-report-note',text:'Simulated estimate. Battery charge, wheel traction, tuning and field differences change real results, so test on your robot before a match.'}));
    host.replaceChildren(...parts);
  }
  return {build,render,nextSteps,legOf,activity,action};
});
