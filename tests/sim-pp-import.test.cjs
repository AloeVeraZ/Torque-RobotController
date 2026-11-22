'use strict';
// Importing a path file (.pp): Deck's own file restores its pins exactly; a Pedro Visualizer file becomes pins and paths.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const P=require('../ui/sim-planner.js'),X=require('../ui/sim-export.js');
const fp={front:8,rear:8,half:8},EMPTY={x0:0,y0:0,x1:144,y1:144},GAME={x0:1.326,y0:1.326,x1:142.674,y1:142.674};
const layoutOf=(start,zones=[],field='empty')=>({name:'Import',field,width:144,height:144,start,zones});
const zones=[{id:'box',type:'rect',x:70,y:60,width:14,height:30,angle:0}];
const pins=[{x:40,y:24,wait:.5,action:'Intake',path:{power:.6}},{x:110,y:40,path:{rotate:'tangent',controls:[{x:80,y:20},{x:100,y:20}]}},{x:110,y:110,turn:90,turnMode:'absolute',path:{kind:'action',action:'Shoot',rotate:'relative',angle:270}},{x:30,y:110,path:{rotate:'track',target:{x:72,y:72}}},{x:30,y:60,path:{rotate:'spin',spins:1}}];
const start={x:20,y:20,heading:0},project={start,zones,pins,style:'spline',clearance:1,defaultPower:.8};

test('Deck\'s own .pp opens with its starting pose, pins and zones exactly; edited lines are converted instead',()=>{
  const route=P.plan(project,fp),text=X.pp(route,layoutOf(start,zones),{polygon:P.polygon,bounds:EMPTY,pins});
  const r=X.fromPP(text,{field:'empty',bounds:EMPTY});assert.equal(r.exact,true);assert.deepEqual(r.pins,pins);assert.deepEqual(r.start,start);assert.deepEqual(r.zones,zones);assert.deepEqual(r.notes,[]);
  const edited=JSON.parse(text);edited.lines.at(-1).endPoint.x=34;const e=X.fromPP(edited,{field:'empty',bounds:EMPTY});
  assert.equal(e.exact,false);assert.equal(e.pins.at(-1).x,34);assert.equal(e.pins.length,pins.length);
});

test('converted from its lines alone, a Deck file plans the same route again',()=>{
  const route=P.plan(project,fp),data=JSON.parse(X.pp(route,layoutOf(start,zones),{polygon:P.polygon,bounds:EMPTY}));assert.equal(data.deck,undefined);
  const r=X.fromPP(data,{field:'empty',bounds:EMPTY});assert.equal(r.pins.length,pins.length);
  // Power, action paths, pauses, actions and turns at the end point come back from Deck's own line fields.
  assert.deepEqual([r.pins[0].actionSeconds,r.pins[0].action,r.pins[0].path.power],[.5,'Intake',.6]);assert.deepEqual(r.pins[1].path.controls,pins[1].path.controls);assert.equal(r.pins[1].path.rotate,'tangent');
  assert.deepEqual([r.pins[2].path.kind,r.pins[2].path.action,r.pins[2].path.rotate,r.pins[2].path.angle,r.pins[2].turn],['action','Shoot','relative',270,90]);
  assert.deepEqual([r.pins[3].path.rotate,r.pins[3].path.target],['track',{x:72,y:72}]);assert.deepEqual([r.pins[4].path.rotate,r.pins[4].path.angle],['relative',360]);
  const again=P.plan({...project,start:r.start,pins:r.pins,zones:r.zones},fp);
  assert.deepEqual(again.stops.map(s=>[s.x,s.y]),route.stops.map(s=>[s.x,s.y]));assert.ok(Math.abs(again.length-route.length)<.05,`${again.length} vs ${route.length}`);
});

test('the Pedro Visualizer\'s default project: shifted to Deck\'s frame on a game field, its shapes left out there',()=>{
  const file={startPoint:{x:56,y:8,headingDeg:90},lines:[{kind:'atomic',id:'p1',name:'Path 1',endPoint:{x:56,y:36},controlPoints:[],heading:{type:'linear',startDeg:90,endDeg:180},waitBeforeMs:0,waitAfterMs:0,waitBeforeName:'',waitAfterName:''}],
    shapes:[{id:'t1',name:'Red Goal',vertices:[{x:141.5,y:70},{x:141.5,y:141.5},{x:118.3,y:141.5},{x:135.5,y:118},{x:136.3,y:70.2}]}],sequence:[{kind:'path',lineId:'p1'}]};
  const game=X.fromPP(JSON.stringify(file),{field:'biobuzz',bounds:GAME});
  assert.deepEqual(game.start,{x:57.326,y:9.326,heading:90});assert.deepEqual(game.pins,[{x:57.326,y:37.326,path:{style:'sharp',rotate:'turn',heading:-180}}]);
  assert.deepEqual(game.zones,[]);assert.match(game.notes.join(' '),/1 shape from the file was left out/);
  const empty=X.fromPP(file,{field:'empty',bounds:EMPTY});assert.deepEqual(empty.start,{x:56,y:8,heading:90});assert.equal(empty.zones.length,1);assert.equal(empty.zones[0].type,'polygon');assert.equal(empty.zones[0].points.length,5);
});

test('Visualizer features: sequence waits, wait before and after, groups, many control points and piecewise headings',()=>{
  const file={startPoint:{x:20,y:20,headingDeg:0},lines:[
    {kind:'atomic',id:'a',name:'Out',endPoint:{x:60,y:20},controlPoints:[],heading:{type:'constant',degrees:45},waitBeforeMs:300,waitAfterMs:500,waitAfterName:'Score'},
    {kind:'compound',id:'g',name:'Sweep',heading:{type:'linear',startDeg:45,endDeg:135},segments:[{kind:'atomic',id:'g1',endPoint:{x:60,y:60},controlPoints:[],heading:{type:'tangential',reverse:false}},{kind:'atomic',id:'g2',endPoint:{x:60,y:100},controlPoints:[],heading:{type:'tangential',reverse:false}}]},
    {kind:'atomic',id:'b',name:'Curve',endPoint:{x:100,y:100},controlPoints:[{x:70,y:120},{x:80,y:130},{x:90,y:125},{x:95,y:110}],throughPoints:[{x:85,y:118}],heading:{type:'piecewise',piecewiseHeading:{segments:[{startProgress:0,endProgress:1,interpolationType:'facing-point',parameters:{point:{x:72,y:72}}}]}},waitBeforeName:'Aim'},
    {kind:'atomic',id:'c',name:'Mixed',endPoint:{x:100,y:40},controlPoints:[],heading:{type:'piecewise',piecewiseHeading:{segments:[{startProgress:0,endProgress:.5,interpolationType:'linear',parameters:{startDeg:0,endDeg:90}},{startProgress:.5,endProgress:1,interpolationType:'tangential'}]}}}],
    sequence:[{kind:'path',lineId:'a'},{kind:'wait',id:'w',name:'Settle',durationMs:250},{kind:'path',lineId:'g'},{kind:'path',lineId:'b'},{kind:'path',lineId:'c'}]};
  const r=X.fromPP(file,{field:'empty',bounds:EMPTY}),notes=r.notes.join(' | ');
  assert.equal(r.pins.length,5);
  // Wait after (0.5 s) plus the sequence wait (0.25 s) at the first end point; its wait before had nowhere to go.
  assert.deepEqual([r.pins[0].wait,r.pins[0].action,r.pins[0].path.rotate,r.pins[0].path.heading],[.75,'Score','turn',45]);assert.match(notes,/Out: its wait before driving was left out/);assert.match(notes,/Out: holds 45° from the start/);
  // The group's one turn is split across its two segments by length.
  assert.deepEqual([r.pins[1].path.heading,r.pins[2].path.heading],[90,135]);assert.match(notes,/Sweep: one turn across its 2 segments/);
  // Four control points: Deck keeps three; the through point is not used; facing a point becomes tracking it; "Aim" waits at the previous end point.
  assert.deepEqual(r.pins[3].path.controls,[{x:70,y:120},{x:90,y:125},{x:95,y:110}]);assert.deepEqual([r.pins[3].path.rotate,r.pins[3].path.target],['track',{x:72,y:72}]);assert.equal(r.pins[2].action,'Aim');
  assert.match(notes,/Curve: 4 control points; Torque keeps 3/);assert.match(notes,/Curve: its 1 through point is not used/);
  assert.equal(r.pins[4].path.rotate,'tangent');assert.match(notes,/Mixed: a heading in 2 parts; Torque uses its last part/);
});

test('files that are not path files are refused with a reason',()=>{
  assert.throws(()=>X.fromPP('not json',{}),/not JSON/);assert.throws(()=>X.fromPP('{"lines":7}',{}),/has no lines/);assert.throws(()=>X.fromPP('{"lines":[]}',{}),/no paths/);
  assert.throws(()=>X.fromPP({lines:[{kind:'atomic',endPoint:{x:'a',y:2}}]},{}),/Path 1 in the file has no end point/);
});

test('deck-sim import-pp replaces the start and paths from a path file',async()=>{
  const D=require('../tools/deck-sim.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'deck-import-')),file=path.join(dir,'r.json'),pp=path.join(dir,'route.pp'),log=console.log,out=[];
  console.log=(...a)=>out.push(a.join(' '));
  try{await D.main(['new',file,'--field','empty','--length','16','--width','16']);
    fs.writeFileSync(pp,JSON.stringify({startPoint:{x:30,y:30,headingDeg:90},lines:[{kind:'atomic',id:'a',endPoint:{x:30,y:90},controlPoints:[],heading:{type:'tangential',reverse:false},waitAfterMs:400,waitAfterName:'Shoot'}]}));
    await D.main(['import-pp',file,pp]);const l=JSON.parse(fs.readFileSync(file,'utf8')).layouts[0];
    assert.deepEqual(l.start,{x:30,y:30,heading:90});assert.deepEqual(l.pins,[{x:30,y:90,path:{style:'sharp',rotate:'tangent'},wait:.4,action:'Shoot'}]);assert.match(out.join('\n'),/Imported 1 path from route\.pp/);}
  finally{console.log=log;}
});

test('a Visualizer file drawn for a different robot size says so',()=>{
  const file={startPoint:{x:24,y:24,headingDeg:0},lines:[{kind:'atomic',id:'a',endPoint:{x:60,y:24},controlPoints:[],heading:{type:'constant',degrees:0}}],settings:{rWidth:16,rHeight:16}};
  assert.match(X.fromPP(file,{robot:{length:17.56,width:17.79}}).notes.join(' '),/drawn for a 16 × 16 in robot; this one is 17\.56 × 17\.79 in/);
  assert.deepEqual(X.fromPP(file,{robot:{length:16.2,width:15.9}}).notes,[]);assert.deepEqual(X.fromPP(file,{}).notes,[]);
});

test('Deck\'s .pp tells the Visualizer the robot size (its collision footprint), and reads back without a size note',()=>{
  const route=P.plan(project,{front:9,rear:7,half:8.5}),data=JSON.parse(X.pp(route,layoutOf(start,zones),{polygon:P.polygon,bounds:EMPTY}));
  assert.deepEqual(data.settings,{rWidth:17,rHeight:16});
  assert.deepEqual(X.fromPP(data,{field:'empty',bounds:EMPTY,robot:{length:16,width:17}}).notes.filter(n=>/drawn for/.test(n)),[]);
});
