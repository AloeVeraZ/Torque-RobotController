'use strict';
// The mechanism reference library: every record passes the schema (ui/sim-mech-library.js), ids are unique, parents
// exist, joint types exist, and nothing is listed twice.
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../ui/sim-mech-library.js'),data=require('../ui/sim-mech-library-data.js'),T=require('../ui/sim-mechanism-types.js');
test('every library record passes the schema',()=>{assert.deepEqual(L.validate(data,{types:T.TYPES}),[]);});
test('the schema catches what it should',()=>{const ok=structuredClone(data.find(r=>r.id==='claw'&&r.image)||data.find(r=>r.image));
  for(const [change,word] of [[r=>{r.category='nope';},'category'],[r=>{r.image.kind='component-photo';delete r.image.shows;},'component photo'],[r=>{r.refs=[];},'reference'],[r=>{r.type='no-such';},'type'],[r=>{r.legality={status:'rule-checked',rules:[]};},'rule-checked']]){
    const r=structuredClone(ok);change(r);assert.ok(L.problems(r,{types:T.TYPES}).some(p=>p.includes(word)),word);}
  assert.ok(L.validate([ok,ok],{types:T.TYPES}).some(p=>/twice/.test(p)),'a duplicate id');});
// One broken rule at a time: each must be caught, and the sample record must pass as it is.
test('the stricter rules each catch their case',()=>{
  // The claw: a record with a preset, a picture and parameters; filled in where a later edit leaves one out.
  const ok=structuredClone(data.find(r=>r.id==='claw')||data[0]);ok.preset??={states:{open:0,closed:30}};ok.preset.states??={open:0,closed:30};ok.params=Array.isArray(ok.params)&&ok.params.length?ok.params:[{key:'open',label:'Open angle',unit:'deg',min:0,max:180,default:0}];
  ok.image??={kind:'mechanism-photo',page:'https://www.servocity.com/',credit:'ServoCity'};ok.motion??={input:'servo rotation',output:'fingers close'};assert.deepEqual(L.problems(ok,{types:T.TYPES}),[]);
  const cases=[
    [r=>{delete r.aliases;},'aliases'],[r=>{r.aliases='gripper';},'aliases'],[r=>{delete r.tags;},'tags'],
    [r=>{r.uses=[];},'uses'],[r=>{delete r.pros;},'pros'],[r=>{r.cons=[];},'cons'],[r=>{r.failures=[];},'failures'],
    [r=>{delete r.params;},'params'],[r=>{delete r.params[0].unit;},'unit'],[r=>{r.params[0].min='0';},'must be a number'],[r=>{r.params[0].default=NaN;},'must be a number'],
    [r=>{delete r.image;},'image must be'],[r=>{r.image='https://x.test/a.jpg';},'image must be'],
    [r=>{delete r.motion;},'motion'],[r=>{r.motion={input:'servo rotation'};},'motion'],[r=>{r.entry='component';r.motion=null;},'motion'],
    [r=>{r.legality={status:'not-allowed',rules:[]};},'not-allowed'],[r=>{r.legality={status:'rule-checked',rules:['the manual']};},'rule-checked'],
    [r=>{r.legality.note='This is FTC legal.';},'claim'],[r=>{r.legality.note='Fully legal at any event.';},'claim'],
    [r=>{r.verified='2026-02-30';},'verified'],[r=>{r.verified='2999-01-01';},'verified'],[r=>{r.verified='last week';},'verified'],
    [r=>{r.seasons=['someday'];},'seasons'],[r=>{r.seasons=['historical:Into The Deep'];},'seasons'],
    [r=>{r.dof=null;},'dof'],[r=>{r.entry='subassembly';r.dof=1.5;},'dof'],[r=>{r.dof=31;},'dof'],
    [r=>{r.preset.states={open:'zero'};},'preset.states'],[r=>{r.preset.states=[0,30];},'preset.states'],
    [r=>{r.params.push({key:'rigging',label:'Rigging',unit:'choice',default:'belt'});},'lists its choices'],[r=>{r.params.push({key:'rigging',label:'Rigging',unit:'choice',choices:[],default:'belt'});},'lists its choices'],
    [r=>{r.params.push({key:'rigging',label:'Rigging',unit:'choice',choices:['cascade','continuous'],default:'belt'});},'not one of its choices'],[r=>{r.params.push({key:'rigging',label:'Rigging',unit:'choice',choices:['cascade'],default:'cascade',min:0});},'no min or max']];
  for(const [change,word] of cases){const r=structuredClone(ok);change(r);assert.ok(L.problems(r,{types:T.TYPES}).some(p=>p.includes(word)),`${word}: ${change}`);}
  // What passes: a checked record naming its rules, a past game, and a sensor with no motion or degrees of freedom.
  for(const change of [r=>{r.legality={status:'rule-checked',rules:['R301','G402','T405'],note:'Checked against the size rules.'};},r=>{r.seasons=['historical:into-the-deep','non-ftc'];},r=>{r.params.push({key:'rigging',label:'Rigging',unit:'choice',choices:['cascade','continuous','belt','chain'],default:'continuous'},{key:'stages',label:'Stages',unit:'count',min:1,max:4,default:2});},
    r=>{r.entry='sensor';r.type=null;r.dof=null;delete r.motion;delete r.preset;r.image=null;}]){const r=structuredClone(ok);change(r);assert.deepEqual(L.problems(r,{types:T.TYPES}),[]);}});
test('each record with a picture is a photo the app reads and keeps',()=>{const p=L.photos(data);for(const r of data.filter(x=>x.image))assert.deepEqual(p['mech:lib:'+r.id]?.[0],r.image.page);
  const Art=require('../ui/ftc/device-art.js');for(const k of Object.keys(p))assert.ok(Art.PHOTOS[k],`${k} is in the photo table the main process fetches from`);});
// Review round 2 (docs/mechanism-library/review-2.json): R2-1 and R2-5.
test('a spinning part starts with positions and speed in its joint type\'s units (degrees), not 0..1 power',()=>{
  for(const r of data){const t=T.TYPES[r.type];if(!t||t.joint!=='continuous'||!r.preset)continue;const run=Math.abs(r.preset.states?.run??0),type=Math.abs(t.states?.run??0);
    if(run)assert.ok(run>=type/10,`${r.id}: run ${run} vs the type's ${type}`);if(r.preset.speed!=null)assert.ok(r.preset.speed>=(t.speed||1)/10,`${r.id}: speed ${r.preset.speed}`);}});
test('every search alias belongs to one record',()=>{const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),owner=new Map();
  for(const r of data)for(const a of r.aliases||[]){const k=norm(a),o=owner.get(k);assert.ok(!o||o===r.id,`"${a}" is on ${o} and ${r.id}`);owner.set(k,r.id);}});
