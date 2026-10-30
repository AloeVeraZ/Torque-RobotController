'use strict';
// The Video workspace's edit: clips on tracks over one recorded run, the editing operations, undo, what plays at a
// time, run events and suggested camera cuts.
const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../ui/sim-edit.js'),{videoRun}=require('./fixtures/video-run.cjs');
const near=(a,b,e=1e-6)=>Math.abs(a-b)<e;
const v1=doc=>E.onTrack(doc,'V1');
const fresh=()=>E.create({recording:{id:'r1',duration:20,name:'Red auto'}});

test('a new project shows the whole run through the main camera on Video 1',()=>{
  const d=fresh();assert.equal(d.clips.length,1);const c=d.clips[0];assert.deepEqual([c.track,c.start,c.in,c.out,c.camera],['V1',0,0,20,'main']);
  assert.equal(E.duration(d),20);assert.deepEqual(d.tracks.map(t=>t.id),['T1','V2','V1','A1','A2']);assert.equal(d.overlays.match,true);assert.equal(d.overlays.position,false,'technical overlays are off by default');
});

test('splitting, then cutting cameras makes a multi-camera sequence of editable clips',()=>{
  const ed=new E.Editor(fresh());
  for(const [t,cam] of [[4,'chase'],[7,'intake'],[11,'mech'],[15,'turret']])ed.change('Cut',d=>E.ops.cut(d,t,cam));
  assert.deepEqual(v1(ed.doc).map(c=>[c.start,c.camera]),[[0,'main'],[4,'chase'],[7,'intake'],[11,'mech'],[15,'turret']]);
  // Each clip shows the matching part of the run: edit time equals run time until something is retimed.
  for(const c of v1(ed.doc))assert.ok(near(c.in,c.start)&&near(E.end(c),c.out));
  assert.equal(E.resolve(ed.doc,12).layers[0].camera,'mech');assert.ok(near(E.resolve(ed.doc,12).layers[0].source,12));
  // Undo takes back the last cut, redo restores it.
  assert.equal(ed.undo(),'Cut');assert.equal(v1(ed.doc).length,4);assert.equal(ed.redo(),'Cut');assert.equal(v1(ed.doc).at(-1).camera,'turret');
});

test('trimming, moving and overwriting: clips on a track never overlap',()=>{
  const ed=new E.Editor(fresh());const [left]=v1(ed.doc);const right=ed.change('Split',d=>E.ops.split(d,left.id,10));
  ed.change('Trim',d=>E.ops.trim(d,left.id,'end',8));assert.ok(near(E.end(v1(ed.doc)[0]),8));
  ed.change('Trim',d=>E.ops.trim(d,right,'start',12));const r=v1(ed.doc).find(c=>c.id===right);assert.ok(near(r.start,12)&&near(r.in,12),'trimming the start moves the source in too');
  // A trim can not reach before the start of the run.
  ed.change('Trim',d=>E.ops.trim(d,left.id,'start',-5));assert.equal(v1(ed.doc)[0].start,0);
  // Moving the right clip onto the left one overwrites its end.
  ed.change('Move',d=>E.ops.move(d,[right],-7));const list=v1(ed.doc);assert.equal(list.length,2);assert.ok(near(E.end(list[0]),5)&&near(list[1].start,5));
  for(let i=1;i<list.length;i++)assert.ok(E.end(list[i-1])<=list[i].start+1e-9);
  // Overwriting the middle of a clip splits it round the new one.
  const d=fresh();E.ops.add(d,E.videoClip({start:5,in:0,out:2,camera:'turret'}));assert.deepEqual(v1(d).map(c=>[c.start,E.end(c),c.camera]),[[0,5,'main'],[5,7,'turret'],[7,20,'main']]);
  assert.ok(near(v1(d)[2].in,7),'the part after keeps its own source time');
});

test('rearranging: move a clip earlier, ripple delete closes the gap, duplicate places a copy after',()=>{
  const ed=new E.Editor(fresh());const [a]=v1(ed.doc);const b=ed.change('Split',d=>E.ops.split(d,a.id,6));const c=ed.change('Split',d=>E.ops.split(d,b,12));
  ed.change('Delete',d=>E.ops.remove(d,[b],{ripple:true}));assert.deepEqual(v1(ed.doc).map(x=>[x.start,x.in]),[[0,0],[6,12]]);
  const copies=ed.change('Duplicate',d=>E.ops.duplicate(d,[a.id]));assert.equal(copies.length,1);assert.deepEqual(v1(ed.doc).map(x=>[x.start,E.end(x)]),[[0,6],[6,12],[12,20]],'the copy is inserted; the clip after moves along');
  // Moving a clip to another video track.
  ed.change('Move',d=>E.ops.move(d,[c],0,()=> 'V2'));assert.equal(E.onTrack(ed.doc,'V2').length,1);
  assert.equal(E.resolve(ed.doc,13).layers.at(-1).track,'V2','an upper track covers the one below');
  // Undo walks back through every step.
  while(ed.canUndo)ed.undo();assert.deepEqual(v1(ed.doc).map(x=>[x.start,E.end(x)]),[[0,20]]);
});

test('speed changes, slow motion ripples later clips; a freeze frame holds one picture',()=>{
  const d=fresh();const [a]=v1(d);const b=E.ops.split(d,a.id,5);E.ops.speed(d,a.id,.5);
  assert.ok(near(E.end(v1(d)[0]),10),'half speed lasts twice as long');assert.ok(near(v1(d)[1].start,10),'the next clip moves along');
  assert.ok(near(E.resolve(d,4).layers[0].source,2),'at half speed 4 s in shows 2 s of the run');
  const f=E.ops.freeze(d,12,2);const fc=d.clips.find(c=>c.id===f);assert.ok(fc.freeze&&near(E.len(fc),2));
  assert.ok(near(E.resolve(d,12.5).layers[0].source,E.resolve(d,13).layers[0].source),'held');void b;
  assert.ok(near(E.resolve(d,14.5).layers[0].source,7.5),'after the freeze the run carries on where it stopped');
});

test('transitions and fades show in what plays: cross dissolve overlaps the outgoing clip, dip goes through black',()=>{
  const d=fresh();E.ops.cut(d,6,'turret');const c=v1(d)[1];E.ops.set(d,c.id,{transition:'cross',transitionLength:1});
  const mid=E.resolve(d,6.5);assert.equal(mid.layers.length,2);assert.equal(mid.layers[0].camera,'main');assert.ok(near(mid.layers[1].alpha,.5));
  E.ops.set(d,c.id,{transition:'dip'});assert.ok(E.resolve(d,6.01).black>.9);assert.ok(E.resolve(d,5.9).black>.5);assert.equal(E.resolve(d,7).black,0);
  E.ops.set(d,v1(d)[0].id,{fadeIn:1});assert.ok(near(E.resolve(d,.5).layers[0].fade,.5));
  // Titles fade in and out over the picture.
  E.ops.add(d,E.textClip({start:1,dur:3,text:'Red auto'}));assert.equal(E.resolve(d,2).titles[0].clip.text,'Red auto');assert.ok(near(E.resolve(d,1.15).titles[0].alpha,.5));
});

test('the export range, markers and a project saved and opened again',()=>{
  const d=fresh();E.ops.cut(d,5,'chase');E.ops.marker(d,3,'Intake');d.range={in:2,out:9};
  assert.deepEqual(E.exportRange(d),{in:2,out:9});const e=E.sanitize(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(e.clips.map(c=>[c.id,c.camera,c.start]),d.clips.map(c=>[c.id,c.camera,c.start]));assert.deepEqual(e.markers.map(m=>m.label),['Intake']);
  assert.throws(()=>E.sanitize({kind:'nope'}),/not a Deck video project/);
  const bad=E.sanitize({...JSON.parse(JSON.stringify(d)),clips:[{kind:'video',track:'V1',start:-4,in:-1,out:99,camera:'drone',speed:900},{kind:'text',track:'V1'},{kind:'audio',track:'A1',asset:'missing'}]},{duration:20});
  assert.equal(bad.clips.length,1);assert.deepEqual([bad.clips[0].start,bad.clips[0].in,bad.clips[0].out,bad.clips[0].camera,bad.clips[0].speed],[0,0,20,'main',8]);
});

test('run events: intake, ramp, shots, the turret, driving off, strafing and stopping',()=>{
  const ev=E.events(videoRun()),kinds=ev.map(e=>e.kind);
  for(const k of ['drive','strafe','intake-on','ramp-down','pickup','turret','shot','intake-off','stop','end'])assert.ok(kinds.includes(k),k);
  assert.equal(ev.filter(e=>e.kind==='shot').length,2);const first=ev.find(e=>e.kind==='intake-on');assert.ok(near(first.t,3.5,.05));assert.equal(first.camera,'intake');
});

test('a full match marks each new period as a moment',()=>{
  const at=(time,phase)=>({time,truth:{x:0,y:0,heading:0},practice:{phase}});
  const ev=E.events([at(0,'auto'),at(1,'auto'),at(2,'transition'),at(3,'teleop'),at(4,'teleop')]).filter(e=>e.kind==='period');
  assert.deepEqual(ev.map(e=>[e.t,e.label]),[[2,'Transition'],[3,'Teleop starts']]);
  assert.deepEqual(E.events([at(0,'teleop'),at(1,'teleop')]).filter(e=>e.kind==='period'),[]);
});

test('suggested cuts follow the run and are ordinary clips, at least the minimum length',()=>{
  const frames=videoRun(),cuts=E.autoCut(frames,{duration:8});assert.ok(cuts.length>=4,`${cuts.length} cuts`);
  assert.equal(cuts[0].camera,'main');assert.equal(cuts[0].start,0);assert.ok(near(E.end(cuts.at(-1)),8));
  for(let i=1;i<cuts.length;i++){assert.ok(near(cuts[i].start,E.end(cuts[i-1])));assert.ok(E.len(cuts[i-1])>=1.6-1e-9);}
  const at=t=>cuts.find(c=>c.start<=t&&E.end(c)>t).camera;assert.equal(at(4.2),'mech','ramp down');assert.equal(at(6.6),'turret','shooting');
  const ed=new E.Editor(E.create({recording:{id:'r',duration:8}}));ed.change('Suggest cuts',d=>E.ops.replaceTrack(d,'V1',cuts));assert.equal(v1(ed.doc).length,cuts.length);ed.undo();assert.equal(v1(ed.doc).length,1);
});

test('timecode shows minutes, seconds and the frame',()=>{
  assert.equal(E.timecode(0),'0:00.00');assert.equal(E.timecode(4.5),'0:04.15');assert.equal(E.timecode(61+1/30),'1:01.01');assert.equal(E.timecode(2,60),'0:02.00');
});

test('2D recordings edit with the top-down view, which cuts and survives a saved project like any camera',()=>{
  const ed=new E.Editor(fresh());ed.change('Cut',d=>E.ops.cut(d,5,'top'));assert.deepEqual(v1(ed.doc).map(c=>[c.start,c.camera]),[[0,'main'],[5,'top']]);
  assert.equal(E.sanitize(JSON.parse(JSON.stringify(ed.doc))).clips.find(c=>c.start===5).camera,'top');
  assert.equal(E.videoClip({camera:'nowhere'}).camera,'main','an unknown camera falls back to the main one');
});

test('a contact replay holds the picture at each contact, zooms in and out, and survives a saved project',()=>{
  const doc=fresh(),ids=E.addCrashes(doc,[{at:7,x:30,y:40,label:'a field structure'},{at:3,x:1,y:2,label:'the field wall'}]);assert.equal(ids.length,2);
  const replays=v1(doc).filter(c=>c.focus);assert.deepEqual(replays.map(c=>[+c.start.toFixed(3),c.in,c.focus.label]),[[3,3,'the field wall'],[7+E.CRASH_HOLD,7,'a field structure']]);
  assert.ok(near(E.duration(doc),20+2*E.CRASH_HOLD),'each replay adds its hold');
  assert.equal(E.resolve(doc,7+2*E.CRASH_HOLD+.5).layers[0].source.toFixed(2),'7.50','the run carries on after the replay');
  const c=replays[0];assert.equal(E.crashZoom(c,c.start),0);assert.equal(E.crashZoom(c,c.start+E.CRASH_HOLD/2),1);assert.ok(E.crashZoom(c,E.end(c)-.01)<.01);
  assert.equal(doc.markers.filter(m=>m.color===E.CRASH_COLOR).length,2);
  assert.equal(E.sanitize(JSON.parse(JSON.stringify(doc))).clips.filter(x=>x.focus).length,2);
  assert.equal(E.addCrashes(fresh(),[{at:99,x:0,y:0}]).length,0,'a contact outside the recording is left out');
});

test('the end card is on until it is removed, and stays removed when the edit is reopened',()=>{
  const d=E.create({duration:20});assert.equal(d.endCard,true);assert.equal(E.sanitize(JSON.parse(JSON.stringify(d))).endCard,true);
  assert.equal(E.sanitize({...JSON.parse(JSON.stringify(d)),endCard:false}).endCard,false);
});
