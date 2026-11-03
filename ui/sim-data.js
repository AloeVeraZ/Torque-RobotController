(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckSimData=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Run data: every frame of a run is recorded, one timeline replays the field, the graphs and the
  // mechanism views together, and the run is summarised (pieces picked up, shot and landed).
  const PHASES={auto:'#2f8f5b',transition:'#7a7f87',teleop:'#2f6fb5'};
  const wrap=deg=>((deg%360)+540)%360-180,num=v=>Number.isFinite(v)?v:null;
  // Values the Data tab can graph. A value missing from a frame (no sensor estimate, no mechanisms) is a gap.
  const SIGNALS=[
    {key:'speed',label:'Speed',unit:'in/s',color:'#4ea1ff',on:true,get:f=>Math.hypot(f.truth.vx||0,f.truth.vy||0)},
    {key:'heading',label:'Heading',unit:'°',color:'#b79bff',on:true,get:f=>wrap(f.truth.heading||0)},
    {key:'error',label:'Sensor estimate error',unit:'in',color:'#e5484d',on:true,get:f=>f.estimate?Math.hypot(f.estimate.x-f.truth.x,f.estimate.y-f.truth.y):null},
    {key:'forward',label:'Drive power · forward',unit:'',color:'#49cbb3',on:true,get:f=>num(f.command?.forward)},
    {key:'strafe',label:'Drive power · strafe',unit:'',color:'#63c5ff',get:f=>num(f.command?.strafe)},
    {key:'turnPower',label:'Drive power · turn',unit:'',color:'#f2bc62',get:f=>num(f.command?.turn)},
    {key:'turn',label:'Turn rate',unit:'°/s',color:'#f2bc62',get:f=>num(f.truth.omega)},
    {key:'x',label:'X position',unit:'in',color:'#aeb8c5',get:f=>num(f.truth.x)},
    {key:'y',label:'Y position',unit:'in',color:'#aeb8c5',get:f=>num(f.truth.y)},
    {key:'flywheel',label:'Flywheel',unit:'%',color:'#f2bc62',on:true,get:f=>f.mechanisms?f.mechanisms.flywheel*100:null},
    {key:'turret',label:'Turret',unit:'°',color:'#b79bff',get:f=>num(f.mechanisms?.turret)},
    {key:'held',label:'Pieces held',unit:'',int:true,color:'#f2d14b',on:true,get:f=>num(f.mechanisms?.held)},
    {key:'score',label:'Points',unit:'',int:true,color:'#49cbb3',get:f=>num(f.mechanisms?.score)}];
  const format=(s,v)=>v===null?'—':`${s.int||s.unit==='°'||Math.abs(v)>=100?Math.round(v):v.toFixed(s.unit?1:2)}${s.unit&&s.unit!=='°'&&s.unit!=='%'?' ':''}${s.unit}`;
  // One graph's points: at most `max` samples spread over the run, [seconds from start, value or null].
  function series(frames,signal,max=600){
    if(!frames.length)return [];const t0=frames[0].time,step=Math.max(1,Math.ceil(frames.length/max)),out=[];
    for(let i=0;i<frames.length;i+=step)out.push([frames[i].time-t0,signal.get(frames[i])]);
    if((frames.length-1)%step)out.push([frames.at(-1).time-t0,signal.get(frames.at(-1))]);return out;
  }
  const el=(tag,attrs={},children=[])=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(attrs))k==='text'?e.textContent=v:e.setAttribute(k,v);e.append(...children);return e;};
  const NS='http://www.w3.org/2000/svg',svg=(tag,attrs={})=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
  // What a recorded run achieved, from its last frame.
  function analysis(frames){
    const last=frames.at(-1);if(!last)return null;const m=last.mechanisms,time=last.time-frames[0].time;
    return {time,zoneTouches:last.violations?.length||0,pickedUp:m?.pickedUp??null,shots:m?.shots??null,landed:m?.landed??null,accuracy:m&&m.shots?Math.round(100*m.landed/m.shots):null,held:m?.held??null,tips:m?.tips??null,score:m?.score??null};
  }
  // Rows for an analysis panel: [label, value].
  function rows(a){
    if(!a)return [];const out=[['Time recorded',`${a.time.toFixed(1)} s`]];
    if(a.shots!==null)out.push(['Picked up',String(a.pickedUp)],['Shot',String(a.shots)],['Landed in the hive',a.shots?`${a.landed} of ${a.shots} (${a.accuracy}%)`:'0'],['Hive tips',String(a.tips??0)],['Points',String(a.score??0)],['Still holding',String(a.held)]);
    out.push(['Zone touches',String(a.zoneTouches)]);return out;
  }
  const list=a=>el('dl',{class:'sim-analysis-list'},rows(a).flatMap(([k,v])=>[el('dt',{text:k}),el('dd',{text:v})]));

  // The robot from above, front up: chassis, each intake's rollers (lit while running), storage slots
  // (pollen yellow, nectar red), and each shooter at its mount (a turret's angle, a fixed shooter's
  // facing, the flywheel speed ring). `highlight` ('intake:0', 'shooter:1', 'storage') outlines the part
  // being edited. Returns a one-line caption. Shared by Setup and Data.
  function drawMechanisms(mechView,m,robot,ms,{highlight=null}={}){
    // Leave room for intakes that stick out past the frame.
    const out=m?.enabled?Math.max(0,...m.intakes.map(i=>i.reach||0)):0,s=100/(Math.max(robot.length,robot.width)+2*out),L=robot.length*s,W=robot.width*s;mechView.replaceChildren();
    // Robot frame (x forward, y left) to this drawing: rotate(-90) puts the front up, so y is negated.
    const at=(x,y)=>[x,-y],dir=deg=>-deg;
    const body=svg('g',{transform:'rotate(-90)'});mechView.append(body);
    body.append(svg('rect',{x:-L/2,y:-W/2,width:L,height:W,rx:4,class:'sim-data-chassis'+(highlight==='storage'?' highlight':'')}),svg('path',{d:`M${L/2-14} 0 L${L/2-4} 0 M${L/2-9} -5 L${L/2-4} 0 L${L/2-9} 5`,class:'sim-data-front'}));
    if(!m?.enabled)return 'No parts yet: add an intake or a shooter.';
    const cmd=ms?.command||{},on=!!cmd.intake,edge={front:[L/2,0,'v'],back:[-L/2,0,'v'],left:[0,W/2,'h'],right:[0,-W/2,'h']};
    // Each intake's box (its hitbox): a roller strip at the frame plus how far it sticks out, as wide as its mouth.
    m.intakes.forEach((intake,n)=>{for(const e of intake.sides){const [ex,ey,o]=edge[e],[cx,cy]=at(ex,ey),span=Math.min(intake.width??(o==='v'?robot.width:robot.length),o==='v'?robot.width:robot.length)*s,depth=Math.max(5,(intake.reach||0)*s+5),sign=e==='front'||e==='right'?1:-1;
      body.append(svg('rect',{...(o==='v'?{x:sign>0?cx-5:cx-depth+5,y:-span/2,width:depth,height:span}:{x:-span/2,y:(e==='left'?cy-depth+5:cy-5),width:span,height:depth}),rx:2,class:'sim-data-intake'+(on?' on':'')+(highlight===`intake:${n}`?' highlight':'')}));}});
    // Storage: pollen slots then nectar slots, filled with what the robot holds.
    const held=ms?.held??m.preload.pollen,pollen=ms?.pollen??Math.min(held,m.capacity.pollen),nectar=ms?.nectar??Math.max(0,held-pollen);
    const slots=[...Array.from({length:m.capacity.pollen},(_,i)=>['pollen',i<pollen]),...Array.from({length:m.capacity.nectar},(_,i)=>['nectar',i<nectar])];
    slots.forEach(([kind,full],i)=>{const [cx,cy]=at(-L/2+12+i*10,W/2-12);body.append(svg('circle',{cx,cy,r:kind==='nectar'?4.8:4.2,class:`sim-data-piece ${kind}`+(full?' held':'')}));});
    const half={x:L/2-16,y:W/2-16},Mech=globalThis.DeckMechanisms||require('./sim-mechanisms.js'),spin=ms?.flywheel??0,r=Math.min(13,Math.min(L,W)/6);
    // Two shooters on one turret: one turntable with two barrels side by side.
    const lane=n=>m.shooters[1]?.sharesTurret?(n?3.5:-3.5):0;
    m.shooters.forEach((shooter,n)=>{const [fx,fy]=Mech.MOUNT_AT[shooter.mount]||[0,0],[tx,ty]=at(fx*half.x,fy*half.y),angle=shooter.type==='turret'?(ms?.turret||0):Mech.FACING[shooter.facing];
      const g=svg('g',{transform:`translate(${tx} ${ty})`,class:highlight===`shooter:${n}`?'highlight':''});body.append(g);
      if(!shooter.sharesTurret)g.append(shooter.type==='turret'?svg('circle',{r,class:'sim-data-turret'+(ms?.aligned?' aligned':'')}):svg('rect',{x:-r*.8,y:-r*.8,width:r*1.6,height:r*1.6,rx:3,class:'sim-data-turret fixed'}));
      g.append(svg('path',{d:`M0 ${lane(n)} L${r+8} ${lane(n)}`,transform:`rotate(${dir(angle)})`,class:'sim-data-barrel '+shooter.pieces}));
      const a=spin*2*Math.PI;if(!shooter.sharesTurret)g.append(svg('path',{d:spin>0.999?`M ${r+3} 0 A ${r+3} ${r+3} 0 1 1 ${r+2.99} -0.01`:`M ${r+3} 0 A ${r+3} ${r+3} 0 ${a>Math.PI?1:0} 1 ${(r+3)*Math.cos(a)} ${(r+3)*Math.sin(a)}`,class:'sim-data-spin'+(spin>=.95?' ready':'')}));
      if(cmd.feed)g.append(svg('circle',{cx:(r+12)*Math.cos(dir(angle)*Math.PI/180),cy:(r+12)*Math.sin(dir(angle)*Math.PI/180),r:4,class:'sim-data-piece held '+(shooter.pieces==='nectar'?'nectar':'pollen')}));});
    const holding=`Holding ${pollen} of ${m.capacity.pollen} pollen${m.capacity.nectar?` and ${nectar} of ${m.capacity.nectar} nectar`:''}`;
    if(!m.shooters.length)return `${holding}${on?' · intake on':''}`;
    return `${holding} · flywheel ${Math.round(spin*100)}%${spin>=.95?' (ready)':''}${Mech.hasTurret(m)?` · turret ${Math.round(ms?.turret||0)}°`:''}${ms?.aligned?' · on target':''}${cmd.feed?' · feeding':''}${on?' · intake on':''} · ${ms?.shots??0} shot${(ms?.shots??0)===1?'':'s'}`;
  }

  const swatch=color=>{const e=el('span',{class:'sim-data-swatch'});e.style.background=color;return e;};
  function create({panelHost,graphsHost=panelHost,onScrub,settings}){
    let frames=[],cursor=null,live=true;const chosen=new Set(SIGNALS.filter(s=>s.on).map(s=>s.key));
    const range=el('input',{type:'range',min:'0',max:'0',step:'0.01',value:'0','aria-label':'Run timeline'}),clock=el('output',{class:'sim-data-clock'}),liveButton=el('button',{type:'button',class:'secondary'},['Live']);
    const track=el('div',{class:'sim-data-track'},[range]),summary=el('div',{class:'sim-analysis'}),empty=el('p',{class:'sim-data-empty',text:'No run recorded yet. Press Run beside the field: speed, heading, sensor error, drive power and mechanisms are graphed here while the robot drives.'});
    const lanes=el('div',{class:'sim-data-lanes'}),picks=el('div',{class:'sim-data-series'}),boxes=new Map();
    for(const s of SIGNALS){const box=el('input',{type:'checkbox'});box.checked=chosen.has(s.key);box.onchange=()=>{box.checked?chosen.add(s.key):chosen.delete(s.key);render();};boxes.set(s.key,box);
      picks.append(el('label',{class:'check'},[box,swatch(s.color),el('span',{text:s.label})]));}
    const recorded=el('div',{class:'sim-data-recorded'},[
      el('div',{class:'sim-data-timeline'},[track,el('div',{class:'sim-data-row'},[clock,liveButton])]),
      el('p',{class:'hint',text:'Drag the timeline or any graph to replay that moment on the field. Green is autonomous, blue is teleop.'})]);
    const charts=el('div',{class:'sim-data-recorded'},[el('h3',{text:'Graphs'}),lanes,el('details',{class:'sim-data-pick'},[el('summary',{text:'Choose graphs'}),picks]),el('h3',{text:'Summary'}),summary]);
    panelHost.append(empty,recorded);if(graphsHost!==panelHost)graphsHost.append(charts);else panelHost.append(charts);
    range.oninput=()=>{live=false;cursor=Number(range.value);scrub();};
    liveButton.onclick=()=>{live=true;cursor=null;onScrub(null);render();};
    // Dragging across a graph scrubs the timeline.
    lanes.onpointerdown=e=>{const lane=e.target.closest('.sim-data-lane');if(!lane||!frames.length)return;try{lanes.setPointerCapture(e.pointerId);}catch{}const move=ev=>{const r=lanes.querySelector('svg')?.getBoundingClientRect();if(!r?.width)return;live=false;cursor=Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width))*duration();range.value=String(cursor);scrub();};move(e);lanes.onpointermove=move;lanes.onpointerup=lanes.onpointercancel=()=>{lanes.onpointermove=null;};};
    const t0=()=>frames[0]?.time??0,duration=()=>frames.length?frames.at(-1).time-t0():0;
    // A graph per chosen value: its name and value at the cursor above a line over the whole run.
    function graphs(f){
      const span=duration()||1,W=1000,H=48,at=f?(f.time-t0())/span*W:W,shown=SIGNALS.filter(s=>frames.some(fr=>s.get(fr)!==null));
      for(const s of SIGNALS)boxes.get(s.key).parentElement.hidden=!shown.includes(s);
      lanes.replaceChildren(...shown.filter(s=>chosen.has(s.key)).map(s=>{
        const pts=series(frames,s),vals=pts.map(p=>p[1]).filter(v=>v!==null);if(!vals.length)vals.push(0);let lo=Math.min(...vals),hi=Math.max(...vals);if(hi-lo<1e-6){lo-=1;hi+=1;}const pad=(hi-lo)*.1,y=v=>H-((v-lo+pad)/(hi-lo+2*pad))*H;
        // Gaps where the value was not recorded split the line.
        const runs=[];let cur=[];for(const [t,v] of pts){if(v===null){if(cur.length)runs.push(cur);cur=[];}else cur.push(`${(t/span*W).toFixed(1)},${y(v).toFixed(1)}`);}if(cur.length)runs.push(cur);
        const plot=svg('svg',{viewBox:`0 0 ${W} ${H}`,preserveAspectRatio:'none',class:'sim-data-graph',role:'img','aria-label':`${s.label} over the run`});
        if(lo<0&&hi>0)plot.append(svg('line',{x1:0,x2:W,y1:y(0),y2:y(0),class:'sim-data-zero'}));
        for(const r of runs)plot.append(svg('polyline',{points:r.join(' '),stroke:s.color,class:'sim-data-line'}));
        plot.append(svg('line',{x1:at,x2:at,y1:0,y2:H,class:'sim-data-cursor'}));
        return el('div',{class:'sim-data-lane'},[el('div',{class:'sim-data-lane-head'},[el('span',{text:s.label}),el('strong',{text:format(s,f?s.get(f):null)})]),plot,el('div',{class:'sim-data-lane-range'},[el('span',{text:format(s,Math.min(...vals))}),el('span',{text:format(s,Math.max(...vals))})])]);}));
      if(!lanes.children.length)lanes.append(el('p',{class:'hint',text:'Choose a value to graph.'}));
    }
    const at=t=>{if(!frames.length)return null;const target=t0()+t;let lo=0,hi=frames.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(frames[mid].time<target)lo=mid+1;else hi=mid;}return frames[lo];};
    function scrub(){const span=duration();if(cursor!==null)cursor=Math.max(0,Math.min(span,cursor));const f=cursor===null?frames.at(-1):at(cursor);onScrub(live?null:f);render(f);}
    function render(f=live?frames.at(-1):at(cursor??0)){
      clearTimeout(trailing);stale=false;
      const span=duration();range.max=String(Math.max(0,span).toFixed(2));range.value=live?range.max:String(cursor??0);clock.textContent=`${(live?span:cursor||0).toFixed(2)} s of ${span.toFixed(2)} s${live?' · live':''}`;liveButton.disabled=live;
      if(frames.length&&span){const stops=[];let phase=frames[0].practice?.phase,from=0;for(let i=1;i<=frames.length;i++){const p=frames[i]?.practice?.phase;if(i===frames.length||p!==phase){const a=(frames[from].time-t0())/span*100,b=(frames[i-1].time-t0())/span*100,c=PHASES[phase]?PHASES[phase]+'66':'transparent';stops.push(`${c} ${a}%`,`${c} ${b}%`);from=i;phase=p;}}track.style.background=`linear-gradient(90deg,${stops.join(',')})`;}else track.style.background='';
      empty.hidden=!!frames.length;recorded.hidden=charts.hidden=!frames.length;
      if(frames.length){summary.replaceChildren(list(analysis(frames)));graphs(f);}
    }
    // Graphs redraw 4 times a second while the robot moves, once a second while it stands still.
    let renderTimer=0,trailing=0,stale=false,onScreen=true,still=0;
    if(typeof IntersectionObserver==='function')new IntersectionObserver(seen=>{onScreen=seen.some(e=>e.isIntersecting);if(onScreen&&stale){stale=false;render();}}).observe(panelHost);
    return {
      record(f){if(!f?.truth)return;const last=frames.at(-1);still=last?.truth&&last.truth.x===f.truth.x&&last.truth.y===f.truth.y&&last.truth.heading===f.truth.heading?still+1:0;if(last&&f.time<last.time-1e-6)frames=[];if(last&&Math.abs(f.time-last.time)<1e-6)frames[frames.length-1]=f;else frames.push(f);if(frames.length>24000)frames.splice(0,4000);
        if(live){if(!onScreen){stale=true;return;}const now=performance.now(),every=still>15?1000:250;if(now-renderTimer>every){renderTimer=now;render();}else{clearTimeout(trailing);trailing=setTimeout(()=>{renderTimer=performance.now();render();},260);}}},
      reset(){frames=[];cursor=null;live=true;render();},
      // Replay the moment `seconds` after the run started, as dragging the timeline there would.
      seek(seconds){if(!frames.length)return;live=false;cursor=seconds;scrub();},
      frames:()=>frames,analysis:()=>analysis(frames),live:()=>live,render:()=>render()};
  }
  return {analysis,rows,list,create,drawMechanisms,series,SIGNALS};
});
