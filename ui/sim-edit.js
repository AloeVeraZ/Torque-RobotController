(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckEdit=value;})(typeof globalThis==='object'?globalThis:this,()=>{
  'use strict';
  // Video projects: the edit the Video workspace makes from one recorded run. The recording never changes; the edit
  // is clips on tracks that each show part of it through one camera (or a title, or an audio file), at a time on the
  // edited video's own clock. Placing a clip overwrites whatever was under it on its track, the way an editor's
  // overwrite edit does; every change is one undo step.
  // A contact replay holds the picture 3.6 s: 0.9 s zooming in, 1.8 s on the contact, 0.9 s zooming out.
  const CRASH_HOLD=3.6,CRASH_COLOR='#e5484d';
  const VERSION=1,EPS=1e-6,MIN=1/30,finite=Number.isFinite,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  // The five run cameras (sim-cameras.js) and the top-down view of the whole field that 2D recordings film.
  const CAMERA_IDS=['main','mech','turret','chase','intake','top'];
  // Top to bottom as the timeline shows them; video tracks higher up cover the ones below.
  const TRACKS=[{id:'T1',kind:'text',name:'Titles'},{id:'V2',kind:'video',name:'Video 2'},{id:'V1',kind:'video',name:'Video 1'},{id:'A1',kind:'audio',name:'Audio 1'},{id:'A2',kind:'audio',name:'Audio 2'}];
  const OVERLAYS={match:'Period, clock & points',camera:'Camera name',position:'Position & heading',velocity:'Speed',turret:'Turret angle',mechanism:'Mechanism state',shots:'Shot markers',path:'Path map',timestamp:'Run time'};
  const TEXT_STYLES={title:'Title (centre)',lower:'Lower third',caption:'Caption (bottom)',corner:'Corner label'};
  const TRANSITIONS={cut:'Cut',cross:'Cross dissolve',dip:'Dip to black'};
  let counter=0;const uid=p=>`${p}${Date.now().toString(36)}${(counter++).toString(36)}`;
  const clone=v=>JSON.parse(JSON.stringify(v));
  // ---------------------------------------------------------------- clip lengths
  // How long a clip lasts on the edit's clock: a video clip's source part played at its speed (a freeze frame holds
  // one picture for `hold` seconds), a title's duration, an audio clip's part of its file.
  const len=c=>c.kind==='video'?(c.freeze?c.hold:(c.out-c.in)/c.speed):c.kind==='text'?c.dur:(c.out-c.in);
  const end=c=>c.start+len(c);
  // The source time a video clip shows at edit time t.
  const sourceAt=(c,t)=>c.freeze?c.in:c.in+(t-c.start)*c.speed;
  function trimStart(c,t){const d=t-c.start;if(c.kind==='video'){if(c.freeze)c.hold-=d;else c.in+=d*c.speed;}else if(c.kind==='text')c.dur-=d;else c.in+=d;c.start=t;}
  function trimEnd(c,t){const d=t-c.start;if(c.kind==='video'){if(c.freeze)c.hold=d;else c.out=c.in+d*c.speed;}else if(c.kind==='text')c.dur=d;else c.out=c.in+d;}
  const trackOf=(doc,id)=>doc.tracks.find(t=>t.id===id);
  const onTrack=(doc,track)=>doc.clips.filter(c=>c.track===track).sort((a,b)=>a.start-b.start);
  // ---------------------------------------------------------------- documents
  function create({recording,name}={}){
    const duration=recording?.duration||0;
    const doc={kind:'deck-video-edit',version:VERSION,id:uid('p'),name:String(name||recording?.name||'Run video').slice(0,80),recording:recording?.id||null,duration,
      settings:{width:1920,height:1080,fps:30},tracks:clone(TRACKS).map(t=>({...t,muted:false,hidden:false,locked:false})),clips:[],markers:[],range:null,
      overlays:{match:true,camera:false,position:false,velocity:false,turret:false,mechanism:false,shots:false,path:false,timestamp:false},endCard:true,cameras:{},audio:[]};
    if(duration>0)doc.clips.push(videoClip({track:'V1',start:0,in:0,out:duration,camera:'main'}));
    return doc;
  }
  function videoClip(o){return {id:uid('c'),kind:'video',track:o.track||'V1',start:o.start||0,in:o.in||0,out:o.out??o.in??0,camera:CAMERA_IDS.includes(o.camera)?o.camera:'main',speed:o.speed||1,freeze:!!o.freeze,hold:o.hold||0,fadeIn:o.fadeIn||0,fadeOut:o.fadeOut||0,transition:o.transition||'cut',transitionLength:o.transitionLength??.5,pip:!!o.pip,volume:1,focus:focusOf(o.focus)};}
  // A contact replay's subject: where on the field the robot touched something ({x, y} in field inches), what it
  // touched and when (seconds of the recording). Anything else is no focus.
  function focusOf(f){return f&&finite(f.x)&&finite(f.y)?{x:clamp(f.x,-50,250),y:clamp(f.y,-50,250),label:String(f.label||'something').slice(0,60),at:finite(f.at)?Math.max(0,f.at):0}:null;}
  function textClip(o){return {id:uid('c'),kind:'text',track:o.track||'T1',start:o.start||0,dur:o.dur||3,text:String(o.text??'Title').slice(0,200),sub:String(o.sub??'').slice(0,200),style:TEXT_STYLES[o.style]?o.style:'title',fadeIn:o.fadeIn??.3,fadeOut:o.fadeOut??.3};}
  function audioClip(o){return {id:uid('c'),kind:'audio',track:o.track||'A1',start:o.start||0,in:o.in||0,out:o.out||0,asset:o.asset,volume:o.volume??1,muted:!!o.muted,fadeIn:o.fadeIn||0,fadeOut:o.fadeOut||0};}
  // A project from a file or storage, with anything out of range put right and anything unknown dropped.
  function sanitize(raw,{duration}={}){
    if(!raw||raw.kind!=='deck-video-edit')throw Error('That is not a Deck video project.');
    const base=create({});const D=finite(duration)?duration:finite(raw.duration)?raw.duration:0,num=(v,d,a=-Infinity,b=Infinity)=>finite(v)?clamp(v,a,b):d;
    const doc={...base,id:typeof raw.id==='string'?raw.id.slice(0,60):base.id,name:String(raw.name||'Run video').slice(0,80),recording:typeof raw.recording==='string'?raw.recording.slice(0,80):null,duration:D};
    const s=raw.settings||{};doc.settings={width:[1280,1920,2560,3840,720,1080].includes(s.width)?s.width:1920,height:[720,1080,1440,2160,1280,1920].includes(s.height)?s.height:1080,fps:[24,30,60].includes(s.fps)?s.fps:30};
    if(Array.isArray(raw.tracks))doc.tracks=doc.tracks.map(t=>{const r=raw.tracks.find(x=>x?.id===t.id)||{};return {...t,muted:!!r.muted,hidden:!!r.hidden,locked:!!r.locked};});
    for(const k of Object.keys(doc.overlays))if(typeof raw.overlays?.[k]==='boolean')doc.overlays[k]=raw.overlays[k];
    if(raw.endCard===false)doc.endCard=false;
    doc.cameras=raw.cameras&&typeof raw.cameras==='object'?clone(raw.cameras):{};
    doc.audio=Array.isArray(raw.audio)?raw.audio.filter(a=>a&&typeof a.id==='string').slice(0,16).map(a=>({id:a.id.slice(0,60),name:String(a.name||'Audio').slice(0,120),duration:num(a.duration,0,0,36000)})):[];
    const assets=new Set(doc.audio.map(a=>a.id)),ids=new Set();
    doc.clips=(Array.isArray(raw.clips)?raw.clips:[]).slice(0,2000).flatMap(c=>{
      if(!c||!trackOf(doc,c.track))return [];const kind=trackOf(doc,c.track).kind;if(c.kind!==kind)return [];let out;
      if(kind==='video'){out=videoClip({...c,start:num(c.start,0,0),in:num(c.in,0,0,D),out:num(c.out,0,0,D),speed:num(c.speed,1,.1,8),hold:num(c.hold,0,0,600),fadeIn:num(c.fadeIn,0,0,10),fadeOut:num(c.fadeOut,0,0,10),transitionLength:num(c.transitionLength,.5,.05,5)});
        out.transition=TRANSITIONS[c.transition]?c.transition:'cut';if(!out.freeze&&out.out<out.in)[out.in,out.out]=[out.out,out.in];}
      else if(kind==='text')out=textClip({...c,start:num(c.start,0,0),dur:num(c.dur,3,MIN,600),fadeIn:num(c.fadeIn,.3,0,10),fadeOut:num(c.fadeOut,.3,0,10)});
      else{if(!assets.has(c.asset))return [];out=audioClip({...c,start:num(c.start,0,0),in:num(c.in,0,0),out:num(c.out,0,0),volume:num(c.volume,1,0,2),fadeIn:num(c.fadeIn,0,0,30),fadeOut:num(c.fadeOut,0,0,30)});}
      if(typeof c.id==='string'&&!ids.has(c.id))out.id=c.id.slice(0,60);ids.add(out.id);return len(out)>=MIN-EPS?[out]:[];});
    doc.markers=(Array.isArray(raw.markers)?raw.markers:[]).slice(0,500).filter(m=>m&&finite(m.t)).map(m=>({id:typeof m.id==='string'?m.id.slice(0,60):uid('m'),t:Math.max(0,m.t),label:String(m.label||'').slice(0,60),color:/^#[0-9a-f]{6}$/i.test(m.color)?m.color:'#f2bc62'}));
    const r=raw.range;doc.range=r&&finite(r.in)&&finite(r.out)&&r.out-r.in>=MIN?{in:Math.max(0,r.in),out:r.out}:null;
    for(const t of doc.tracks)settle(doc,t.id);return doc;
  }
  // ---------------------------------------------------------------- placing clips
  // Clips on one track never overlap: `clip` takes its place and what was under it is trimmed, split or removed.
  function place(doc,clip,keep=new Set()){
    const s=clip.start,e=end(clip);
    for(const o of [...doc.clips]){if(o===clip||o.track!==clip.track||keep.has(o.id))continue;const os=o.start,oe=end(o);if(oe<=s+EPS||os>=e-EPS)continue;
      if(os>=s-EPS&&oe<=e+EPS){doc.clips.splice(doc.clips.indexOf(o),1);continue;}
      if(os<s&&oe>e){const right={...clone(o),id:uid('c')};trimEnd(o,s);trimStart(right,e);doc.clips.push(right);continue;}
      if(os<s)trimEnd(o,s);else trimStart(o,e);}
  }
  // Drops slivers left by trimming and keeps the clips in time order.
  function settle(doc,track){
    doc.clips=doc.clips.filter(c=>c.track!==track||len(c)>=MIN-EPS);
    doc.clips.sort((a,b)=>a.track===b.track?a.start-b.start:0);
  }
  const at=(doc,track,t)=>onTrack(doc,track).find(c=>c.start<=t+EPS&&end(c)>t+EPS)||null;
  // The edit's length: to the end of its last video or title clip.
  const duration=doc=>Math.max(0,...doc.clips.filter(c=>c.kind!=='audio').map(end));
  // ---------------------------------------------------------------- edits
  // Each takes the document and changes it; the Editor wraps them in undo steps.
  const ops={
    add(doc,clip){doc.clips.push(clip);place(doc,clip);settle(doc,clip.track);return clip.id;},
    // Splits a clip at edit time t, returning the new right-hand part's id (null when t is not inside it).
    split(doc,id,t){const c=doc.clips.find(x=>x.id===id);if(!c||t<=c.start+MIN/2||t>=end(c)-MIN/2)return null;const right={...clone(c),id:uid('c')};
      trimEnd(c,t);trimStart(right,t);if(c.kind==='video'){right.transition='cut';right.fadeIn=0;c.fadeOut=0;}doc.clips.push(right);settle(doc,c.track);return right.id;},
    // Splits every clip under t on the given tracks (all unlocked tracks by default).
    splitAt(doc,t,tracks){const out=[];for(const tr of tracks||doc.tracks.filter(x=>!x.locked).map(x=>x.id)){const c=at(doc,tr,t);if(c){const id=ops.split(doc,c.id,t);if(id)out.push(id);}}return out;},
    // Moves clips by dt seconds (and onto another track of the same kind); they overwrite what they land on.
    move(doc,ids,dt,trackFor=null){const moving=doc.clips.filter(c=>ids.includes(c.id));if(!moving.length)return;const first=Math.min(...moving.map(c=>c.start));dt=Math.max(dt,-first);
      for(const c of moving){c.start=Math.max(0,c.start+dt);const tr=trackFor?.(c);if(tr&&trackOf(doc,tr)?.kind===trackOf(doc,c.track).kind)c.track=tr;}
      const keep=new Set(ids);for(const c of moving)place(doc,c,keep);for(const t of doc.tracks)settle(doc,t.id);},
    // Moves one edge of a clip to edit time t, no further than its source allows; with ripple the clips after it on
    // its track move with the end.
    trim(doc,id,edge,t,{ripple=false,limit}={}){const c=doc.clips.find(x=>x.id===id);if(!c)return;const before=end(c);
      if(edge==='start'){let lo=c.kind==='video'&&!c.freeze?c.start-c.in/c.speed:c.kind==='audio'?c.start-c.in:-Infinity;lo=Math.max(0,lo);t=clamp(t,lo,end(c)-MIN);trimStart(c,t);}
      else{let hi=c.kind==='video'&&!c.freeze?c.start+((limit??doc.duration)-c.in)/c.speed:c.kind==='audio'&&finite(limit)?c.start+(limit-c.in):Infinity;t=clamp(t,c.start+MIN,hi);
        if(ripple){const d=t-before;for(const o of doc.clips)if(o!==c&&o.track===c.track&&o.start>=before-EPS)o.start+=d;}trimEnd(c,t);}
      place(doc,c);settle(doc,c.track);},
    // Removes clips; with ripple the gap closes on each one's track.
    remove(doc,ids,{ripple=false}={}){const gone=doc.clips.filter(c=>ids.includes(c.id)).sort((a,b)=>b.start-a.start);
      for(const c of gone){doc.clips.splice(doc.clips.indexOf(c),1);if(ripple){const l=len(c);for(const o of doc.clips)if(o.track===c.track&&o.start>=c.start-EPS)o.start-=l;}}
      for(const t of doc.tracks)settle(doc,t.id);},
    // Copies of the clips, inserted straight after them on their tracks: what came after moves along.
    duplicate(doc,ids){const src=doc.clips.filter(c=>ids.includes(c.id));if(!src.length)return [];const s=Math.min(...src.map(c=>c.start)),e=Math.max(...src.map(end)),out=[],tracks=new Set(src.map(c=>c.track));
      for(const o of doc.clips)if(tracks.has(o.track)&&!ids.includes(o.id)&&o.start>=e-EPS)o.start+=e-s;
      for(const c of src){const copy={...clone(c),id:uid('c'),start:c.start+(e-s)};doc.clips.push(copy);out.push(copy.id);}
      const keep=new Set(out);for(const id of out)place(doc,doc.clips.find(c=>c.id===id),keep);for(const t of doc.tracks)settle(doc,t.id);return out;},
    setCamera(doc,ids,camera){if(!CAMERA_IDS.includes(camera))return;for(const c of doc.clips)if(ids.includes(c.id)&&c.kind==='video')c.camera=camera;},
    // A camera cut: from edit time t the video clip under it on `track` shows `camera` (to the end of that clip).
    cut(doc,t,camera,track='V1'){const c=at(doc,track,t);if(!c||c.kind!=='video')return null;if(c.camera===camera)return c.id;
      const id=t<=c.start+MIN/2?c.id:ops.split(doc,c.id,t);if(!id)return null;ops.setCamera(doc,[id],camera);return id;},
    // Changes a clip's speed; the clips after it on its track move so nothing is covered.
    speed(doc,id,speed){const c=doc.clips.find(x=>x.id===id);if(!c||c.kind!=='video'||c.freeze)return;const before=end(c);c.speed=clamp(speed,.1,8);const d=end(c)-before;
      for(const o of doc.clips)if(o!==c&&o.track===c.track&&o.start>=before-EPS)o.start+=d;settle(doc,c.track);},
    // Holds the picture at edit time t for `hold` seconds: the clip under t splits and the rest moves later.
    freeze(doc,t,hold=2,track='V1'){const c=at(doc,track,t);if(!c||c.kind!=='video')return null;const src=sourceAt(c,t),right=ops.split(doc,c.id,t);
      for(const o of doc.clips)if(o.track===track&&o.start>=t-EPS)o.start+=hold;
      const f=videoClip({track,start:t,in:src,out:src,camera:c.camera,freeze:true,hold});doc.clips.push(f);settle(doc,track);void right;return f.id;},
    set(doc,id,patch){const c=doc.clips.find(x=>x.id===id);if(!c)return;const before=len(c);Object.assign(c,patch);if(Math.abs(len(c)-before)>EPS){place(doc,c);}settle(doc,c.track);},
    // A contact replay: the picture holds at edit time t for `hold` seconds while the camera zooms in on where the robot
    // touched something (focus), marks it, and zooms back out; then the run carries on.
    crash(doc,t,focus,hold=CRASH_HOLD,track='V1'){const id=ops.freeze(doc,t,hold,track);const c=id&&doc.clips.find(x=>x.id===id);if(!c)return null;c.focus=focusOf(focus);return id;},
    marker(doc,t,label='',color='#f2bc62'){const m={id:uid('m'),t:Math.max(0,t),label:String(label).slice(0,60),color};doc.markers.push(m);doc.markers.sort((a,b)=>a.t-b.t);return m.id;},
    // Replaces the video on `track` with suggested camera cuts (see autoCut).
    replaceTrack(doc,track,clips){doc.clips=doc.clips.filter(c=>c.track!==track).concat(clips.map(c=>({...c,track})));settle(doc,track);}
  };
  // The edit time that shows recording time `source` on a track: in the first playing (not frozen) clip whose part
  // of the recording covers it, or null when no clip does.
  function editTimeOf(doc,source,track='V1'){const c=onTrack(doc,track).find(x=>x.kind==='video'&&!x.freeze&&x.in<=source+EPS&&x.out>source+EPS);return c?c.start+(source-c.in)/c.speed:null;}
  // A contact replay at each contact ({at, x, y, label}, at in seconds of the recording), in time order, with a red
  // marker on the timeline; returns the replays' clip ids. Contacts no clip on the track shows are left out.
  function addCrashes(doc,crashes,{track='V1',hold=CRASH_HOLD}={}){const out=[];
    for(const c of [...(crashes||[])].filter(c=>finite(c?.at)).sort((a,b)=>a.at-b.at)){const t=editTimeOf(doc,c.at,track);if(t===null)continue;
      const id=ops.crash(doc,t,c,hold,track);if(!id)continue;out.push(id);doc.markers=doc.markers.filter(m=>Math.abs(m.t-t)>EPS||m.color!==CRASH_COLOR);
      for(const m of doc.markers)if(m.t>=t-EPS)m.t+=hold;doc.markers.push({id:uid('m'),t,label:`Contact with ${String(c.label||'something').slice(0,46)}`,color:CRASH_COLOR});doc.markers.sort((a,b)=>a.t-b.t);}
    return out;}
  // How far a contact replay has zoomed in at edit time t (0 to 1): in over its first part, held, out over its last.
  function crashZoom(c,t){const L=len(c),ramp=Math.min(.9,L/3),u=clamp(t-c.start,0,L),ease=k=>k*k*(3-2*k);return u<ramp?ease(u/ramp):u>L-ramp?ease((L-u)/ramp):1;}
  // ---------------------------------------------------------------- undo
  // The edit with its undo history: change(label, fn) runs fn on the document as one step.
  class Editor{
    constructor(doc,{limit=200,onChange}={}){this.doc=doc;this.undoStack=[];this.redoStack=[];this.limit=limit;this.onChange=onChange||(()=>{});}
    change(label,fn){const before=JSON.stringify(this.doc);let out;try{out=fn(this.doc);}catch(e){this.doc=JSON.parse(before);throw e;}
      if(JSON.stringify(this.doc)===before)return out;this.undoStack.push({label,doc:before});if(this.undoStack.length>this.limit)this.undoStack.shift();this.redoStack=[];this.onChange(label);return out;}
    undo(){const s=this.undoStack.pop();if(!s)return null;this.redoStack.push({label:s.label,doc:JSON.stringify(this.doc)});this.doc=JSON.parse(s.doc);this.onChange('Undo '+s.label);return s.label;}
    redo(){const s=this.redoStack.pop();if(!s)return null;this.undoStack.push({label:s.label,doc:JSON.stringify(this.doc)});this.doc=JSON.parse(s.doc);this.onChange('Redo '+s.label);return s.label;}
    get canUndo(){return this.undoStack.length>0;}get canRedo(){return this.redoStack.length>0;}
    nextUndo(){return this.undoStack.at(-1)?.label||'';}nextRedo(){return this.redoStack.at(-1)?.label||'';}
  }
  // ---------------------------------------------------------------- what plays at a time
  // The pictures at edit time t, bottom to top: [{clip, camera, source, alpha, pip}] plus how dark the picture is
  // (dip to black and fades), and the titles showing.
  function resolve(doc,t){
    const layers=[];let black=0;
    for(const track of [...doc.tracks].reverse()){if(track.kind!=='video'||track.hidden)continue;const list=onTrack(doc,track.id),i=list.findIndex(c=>c.start<=t+EPS&&end(c)>t+EPS);if(i<0)continue;const c=list[i],prev=list[i-1];
      const adjacent=prev&&Math.abs(end(prev)-c.start)<1e-3,L=Math.min(c.transitionLength||.5,len(c));let alpha=1;
      const fade=(c.fadeIn>0?clamp((t-c.start)/c.fadeIn,0,1):1)*(c.fadeOut>0?clamp((end(c)-t)/c.fadeOut,0,1):1);
      if(adjacent&&c.transition==='cross'&&t<c.start+L){alpha=clamp((t-c.start)/L,0,1);
        // The outgoing clip carries on past its end under the incoming one.
        layers.push({clip:prev,camera:prev.camera,source:clamp(sourceAt(prev,t),0,doc.duration),alpha:1,pip:prev.pip,track:track.id});}
      if(adjacent&&c.transition==='dip'&&t<c.start+L/2)black=Math.max(black,1-clamp((t-c.start)/(L/2),0,1));
      const next=list[i+1];if(next&&Math.abs(end(c)-next.start)<1e-3&&next.transition==='dip'){const Ln=Math.min(next.transitionLength||.5,len(next));if(t>end(c)-Ln/2)black=Math.max(black,1-clamp((end(c)-t)/(Ln/2),0,1));}
      layers.push({clip:c,camera:c.camera,source:clamp(sourceAt(c,t),0,doc.duration),alpha,pip:c.pip,track:track.id,fade});}
    const titles=[];for(const track of doc.tracks){if(track.kind!=='text'||track.hidden)continue;const c=at(doc,track.id,t);if(!c)continue;
      titles.push({clip:c,alpha:(c.fadeIn>0?clamp((t-c.start)/c.fadeIn,0,1):1)*(c.fadeOut>0?clamp((end(c)-t)/c.fadeOut,0,1):1)});}
    return {layers,black,titles};
  }
  // The audio clips that play, with when they start on the edit's clock.
  const audible=doc=>doc.clips.filter(c=>c.kind==='audio'&&!c.muted&&!trackOf(doc,c.track)?.muted);
  // The part of the edit an export covers: the export range, or the whole edit.
  function exportRange(doc){const d=duration(doc);if(doc.range){const a=clamp(doc.range.in,0,d),b=clamp(doc.range.out,0,d);if(b-a>=MIN)return {in:a,out:b};}return {in:0,out:d};}
  // ---------------------------------------------------------------- what happened in the run
  // Moments in the recording worth a camera: intake on and off, a ramp going down, shots, the turret swinging,
  // strafing, driving off and stopping, and each new period of a full match. {t (seconds from the start), kind, label, camera}.
  const PERIODS={transition:'Transition',teleop:'Teleop starts'};
  function events(frames){
    const out=[];if(!frames?.length)return out;const t0=frames[0].time,push=(f,kind,label,camera)=>out.push({t:+(f.time-t0).toFixed(3),kind,label,camera});
    let intake=false,ramp=false,launched=null,picked=null,moving=false,strafing=false,swing=false,still=0,lastT=t0,period=null;
    frames.forEach((f,i)=>{const m=f.mechanisms,c=m?.command||{},tr=f.truth||{},dt=i?f.time-lastT:0;lastT=f.time;
      const p=f.practice?.phase;if(p&&p!==period){if(period&&PERIODS[p])push(f,'period',PERIODS[p],'main');period=p;}
      if(m){if(!!c.intake!==intake){intake=!!c.intake;push(f,intake?'intake-on':'intake-off',intake?'Intake on':'Intake off','intake');}
        const r=(m.ramps||[]).some(v=>v>.5);if(r!==ramp){ramp=r;push(f,r?'ramp-down':'ramp-up',r?'Ramp down':'Ramp up','mech');}
        if(launched!==null&&m.launched>launched)push(f,'shot',`Shot ${m.launched}`,'turret');launched=m.launched??launched;
        if(picked!==null&&m.pickedUp>picked)push(f,'pickup',`Picked up ${m.pickedUp}`,'intake');picked=m.pickedUp??picked;
        const prev=frames[i-1]?.mechanisms,rate=prev&&dt>0?Math.abs((m.turret??0)-(prev.turret??0))/dt:0;if(!swing&&rate>90){swing=true;push(f,'turret','Turret turns','turret');}else if(swing&&rate<20)swing=false;}
      const h=(tr.heading||0)*Math.PI/180,speed=Math.hypot(tr.vx||0,tr.vy||0),side=Math.abs(-(tr.vx||0)*Math.sin(h)+(tr.vy||0)*Math.cos(h));
      if(!moving&&speed>8){moving=true;still=0;push(f,'drive','Drives off','chase');}
      if(moving&&speed<1){still+=dt;if(still>.4){moving=false;push(f,'stop','Stops','main');}}else still=0;
      if(!strafing&&side>14&&side>.6*speed){strafing=true;push(f,'strafe','Strafes','chase');}else if(strafing&&side<6)strafing=false;});
    push(frames.at(-1),'end','Run ends','main');
    return out;
  }
  // Suggested camera cuts for the whole recording, from what the run does: the follow camera to start and finish,
  // the turret around each volley, the front-right camera while a ramp is down, the intake while it runs, the chase
  // camera while it drives fast or strafes. Calm, like a broadcast: no shot shorter than `min` seconds (an eighth of
  // the run, 1.6 to 3.5 s), a clear reason to change angle on a long run, long shots change angle, and each change
  // dissolves over 0.6 s instead of cutting.
  function autoCut(frames,{min,max,duration}={}){
    if(!frames?.length)return [];const t0=frames[0].time,D=duration??frames.at(-1).time-t0,step=.1,n=Math.max(1,Math.round(D/step)),ev=events(frames);
    min??=Math.max(1.6,Math.min(3.5,D/8));max??=Math.max(6.5,min*3);const margin=D>=15?.8:.3;
    const shots=ev.filter(e=>e.kind==='shot').map(e=>e.t),score=[];let j=0;
    for(let k=0;k<n;k++){const t=k*step;while(j<frames.length-1&&frames[j+1].time-t0<=t)j++;const f=frames[j],m=f.mechanisms,c=m?.command||{},tr=f.truth||{},h=(tr.heading||0)*Math.PI/180,speed=Math.hypot(tr.vx||0,tr.vy||0),side=Math.abs(-(tr.vx||0)*Math.sin(h)+(tr.vy||0)*Math.cos(h));
      const s={main:1,mech:0,turret:0,chase:0,intake:0};
      if(speed>18)s.chase=1.8+(side>12?.8:0);
      if(c.intake)s.intake=2.6;if((m?.ramps||[]).some(v=>v>.05))s.mech=3.2;
      if(c.aim||c.spin)s.turret=Math.max(s.turret,1.6);if(c.feed||shots.some(x=>t>=x-.7&&t<=x+1.1))s.turret=3.6;
      if(t<1.5||t>D-1.5)s.main=5;score.push(s);}
    // Pick the best angle per moment, holding each for at least `min` seconds.
    const cuts=[];let cur=null,since=0;
    for(let k=0;k<n;k++){const s=score[k],best=Object.keys(s).reduce((a,b)=>s[b]>s[a]?b:a,'main'),t=k*step;
      if(cur===null){cur=best;since=t;cuts.push({t,camera:cur});continue;}
      const held=t-since;if(best!==cur&&held>=min&&s[best]>s[cur]+margin){cur=best;since=t;cuts.push({t,camera:cur});}
      else if(held>=max){const alt=Object.keys(s).filter(c=>c!==cur).reduce((a,b)=>s[b]>s[a]?b:a);if(s[alt]>=s[cur]-1.2){cur=alt;since=t;cuts.push({t,camera:cur});}}}
    // A last shot shorter than `min` joins the one before it.
    while(cuts.length>1&&D-cuts.at(-1).t<min)cuts.pop();
    return cuts.map((c,i)=>{const e=i+1<cuts.length?cuts[i+1].t:D;return videoClip({start:c.t,in:c.t,out:e,camera:c.camera,...(i?{transition:'cross',transitionLength:.6}:{})});}).filter(c=>len(c)>=MIN);
  }
  // ---------------------------------------------------------------- formatting
  // Edit time as the timeline shows it: m:ss.ff with ff the frame (at fps).
  function timecode(t,fps=30){t=Math.max(0,t||0);const total=Math.round(t*fps),f=total%fps,s=Math.floor(total/fps);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}.${String(f).padStart(2,'0')}`;}
  return {CRASH_HOLD,CRASH_COLOR,editTimeOf,addCrashes,crashZoom,VERSION,TRACKS,OVERLAYS,TEXT_STYLES,TRANSITIONS,CAMERA_IDS,MIN,create,sanitize,videoClip,textClip,audioClip,len,end,sourceAt,onTrack,at,duration,place,ops,Editor,resolve,audible,exportRange,events,autoCut,timecode,uid};
});
