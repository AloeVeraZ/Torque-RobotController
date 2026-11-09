(function(root,factory){const value=factory(root);if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckMechLibrary=value;})(typeof globalThis==='object'?globalThis:this,root=>{
  'use strict';
  // + Add mechanism's reference library: one record per distinct mechanism, part, sensor, configuration or robot
  // architecture, with what it is, how it works, where it is used, its trade-offs and its sources. A record never
  // drives motion by itself: `type` names the DeckMechanismTypes joint type that moves it on the model (a pivot, a
  // slide, a spin), and `preset` the starting values for that joint (named positions, travel, speed). Records live in
  // sim-mech-library-data.js; validate() is what tests/mech-library.test.cjs and the reviewers check them against.

  // Primary categories: the picker's own, in its order.
  const CATEGORIES=[['game','BIOBUZZ'],['intake','Intakes and claws'],['lift','Lifts and slides'],['arm','Arms and linkages'],['score','Shooters and scoring'],
    ['inside','Moving pieces inside'],['endgame','Hang and endgame'],['drive','Drive and odometry'],['sense','Sensors and cameras'],['robot','Other robots'],['custom','Your own']];
  // What kind of thing a record is. A sensor or a software configuration is not a moving mechanism.
  const ENTRIES={mechanism:'Mechanism',subassembly:'Subassembly',component:'Component',sensor:'Sensor',software:'Control setup',architecture:'Robot architecture',concept:'Concept'};
  // What a record's picture is. A component photo never stands for a whole mechanism.
  const IMAGES={'mechanism-photo':'Photo of the mechanism','component-photo':'Photo of a part it uses','schematic':'Engineering schematic','cad':'CAD render','illustration':'Illustration'};
  const REFS=['official','gm0','vendor','team','engineering'];
  const ACTUATION=['motor','servo','crservo','motor+servo','servo+servo','motor+motor','passive','spring','none','varies'];
  const DIFFICULTY=['beginner','intermediate','advanced'];
  const STATUS=['current','common','historical','experimental'];
  const LEGALITY=['not-verified','rule-checked','not-allowed'];
  const CONFIDENCE=['high','medium','low'];
  const has=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
  const str=(v,max=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
  const strs=v=>Array.isArray(v)&&v.every(x=>str(x,400));
  const https=v=>{try{return new URL(v).protocol==='https:';}catch{return false;}};

  // Every problem with one record, as plain sentences ([] when it is fine). types: DeckMechanismTypes.TYPES.
  function problems(r,{types=null,ids=null}={}){const out=[],bad=t=>out.push(`${r?.id||'(no id)'}: ${t}`);
    if(!r||typeof r!=='object')return ['(not an object)'];
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.id||''))bad('id must be lower-case words joined by dashes');
    if(ids){if(ids.has(r.id))bad('id is used twice');ids.add(r.id);}
    if(!str(r.name,90))bad('name is missing or too long');
    if(!Array.isArray(r.aliases)||!strs(r.aliases))bad('aliases must be a list of words (empty when it has none)');
    if(!CATEGORIES.some(([k])=>k===r.category))bad(`category "${r.category}" is not one of the picker's`);
    if(!Array.isArray(r.tags)||!strs(r.tags))bad('tags must be a list of words');
    if(!has(ENTRIES,r.entry))bad(`entry "${r.entry}" is not one of ${Object.keys(ENTRIES).join(', ')}`);
    if(!str(r.family,60))bad('family is missing');
    if(!str(r.short,220))bad('short must be one short sentence (under 220 characters)');
    if(!str(r.how,1400))bad('how it works is missing');
    for(const k of ['uses','pros','cons','failures'])if(!Array.isArray(r[k])||!r[k].length||!strs(r[k]))bad(`${k} must be a list of at least one sentence`);
    if(!(r.dof===null||Number.isInteger(r.dof)&&r.dof>=0&&r.dof<=30))bad('dof must be a whole number (or null for a sensor or setup)');
    if(['mechanism','subassembly'].includes(r.entry)&&!Number.isInteger(r.dof))bad('dof must be a whole number for a mechanism or subassembly');
    // Something that moves says what goes in and what comes out.
    if(['mechanism','subassembly','component'].includes(r.entry)&&!(r.motion&&str(r.motion.input,200)&&str(r.motion.output,200)))bad('motion needs an input and an output');
    if(!ACTUATION.includes(r.actuation))bad(`actuation "${r.actuation}" is not one of ${ACTUATION.join(', ')}`);
    // Something that moves on the model names the joint type that moves it; a sensor, setup or concept may have none.
    if(r.type!=null){if(types&&!types[r.type])bad(`type "${r.type}" is not a DeckMechanismTypes type`);}
    else if(['mechanism','subassembly'].includes(r.entry)&&r.category!=='robot')bad('a mechanism needs a joint type that moves it');
    if(!Array.isArray(r.params))bad('params must be a list (empty when it has none)');
    for(const p of Array.isArray(r.params)?r.params:[]){if(!str(p?.key,40)||!str(p?.label,80))bad('each parameter needs a key and a label');if(!str(p?.unit,20))bad(`parameter ${p?.key}: unit is missing`);
      // A choice (rigging: cascade, continuous…) lists its choices, starts on one of them and has no range.
      if(p?.unit==='choice'){if(!Array.isArray(p.choices)||!p.choices.length||!strs(p.choices))bad(`parameter ${p.key}: a choice lists its choices`);
        else if(p.default!=null&&!p.choices.includes(p.default))bad(`parameter ${p.key}: default is not one of its choices`);if(p.min!=null||p.max!=null)bad(`parameter ${p.key}: a choice has no min or max`);continue;}
      for(const k of ['min','max','default'])if(p&&p[k]!=null&&!Number.isFinite(p[k]))bad(`parameter ${p.key}: ${k} must be a number`);
      if(p.min!=null&&p.max!=null&&!(p.min<=p.max))bad(`parameter ${p.key}: min is above max`);
      if(p.default!=null&&(p.min!=null&&p.default<p.min||p.max!=null&&p.default>p.max))bad(`parameter ${p.key}: default is outside its range`);}
    if(!strs(r.seasons||[])||!(r.seasons||[]).length||!r.seasons.every(x=>/^(general|biobuzz|non-ftc|historical:[a-z0-9-]+)$/.test(x)))bad('seasons must say where it is used (general, biobuzz, non-ftc, or historical:<game>)');
    if(!r.legality||!LEGALITY.includes(r.legality.status))bad('legality.status must be one of '+LEGALITY.join(', '));
    // A rule-checked or not-allowed record names the rules (R301, G402, T405, E101…); no note may say something is legal.
    if(['rule-checked','not-allowed'].includes(r.legality?.status)&&!(Array.isArray(r.legality.rules)&&r.legality.rules.length&&r.legality.rules.every(x=>/^[RGTE]\d+/.test(String(x)))))bad(`a ${r.legality.status} record names the rules it was checked against (R301, G402…)`);
    if(r.legality?.note!=null&&/\b(is|are|fully)\s+(ftc[- ])?legal\b/i.test(String(r.legality.note)))bad('legality note must not claim it is legal');
    if(!Array.isArray(r.refs)||!r.refs.length)bad('at least one reference');
    for(const f of r.refs||[]){if(!str(f.title,200)||!https(f.url)||!REFS.includes(f.kind))bad(`reference "${f.title||f.url}" needs a title, an https url and a kind (${REFS.join(', ')})`);}
    if(!has(r,'image')||!(r.image===null||typeof r.image==='object'&&!Array.isArray(r.image)))bad('image must be a picture or null');
    if(r.image!=null&&typeof r.image==='object'){const i=r.image;if(!has(IMAGES,i.kind))bad(`image kind "${i.kind}" is not one of ${Object.keys(IMAGES).join(', ')}`);
      if(!https(i.page))bad('image needs the https page it is from');if(i.src!=null&&!https(i.src))bad('image src must be https');if(!str(i.credit,200))bad('image needs a credit');
      if(i.kind==='component-photo'&&!str(i.shows,200))bad('a component photo says which part it shows');}
    if(!DIFFICULTY.includes(r.difficulty))bad('difficulty must be '+DIFFICULTY.join(', '));
    if(!CONFIDENCE.includes(r.confidence))bad('confidence must be '+CONFIDENCE.join(', '));
    if(!STATUS.includes(r.status))bad('status must be '+STATUS.join(', '));
    {const v=String(r.verified||''),d=new Date(v+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||isNaN(d)||d.toISOString().slice(0,10)!==v||d.getTime()>Date.now()+86400000)bad('verified must be the date it was last checked (YYYY-MM-DD, not in the future)');}
    if(r.preset?.states!=null&&!(typeof r.preset.states==='object'&&!Array.isArray(r.preset.states)&&Object.values(r.preset.states).every(Number.isFinite)))bad('preset.states must name positions with numbers');
    if(r.parent!=null&&!str(r.parent,60))bad('parent must be another record id');
    return out;}
  // Every problem in a whole library, including parents that do not exist.
  function validate(records,{types=null}={}){const ids=new Set(),out=[];for(const r of records)out.push(...problems(r,{types,ids}));
    const known=new Set(records.map(r=>r.id));for(const r of records)if(r.parent&&!known.has(r.parent))out.push(`${r.id}: parent "${r.parent}" does not exist`);
    // Two records with the same name in the same category are one mechanism listed twice.
    const seen=new Map();for(const r of records){const k=`${r.category}|${String(r.name).toLowerCase()}`;if(seen.has(k))out.push(`${r.id}: same name as ${seen.get(k)} in ${r.category}`);else seen.set(k,r.id);}
    return out;}
  // The words search looks in: its names, aliases, tags, family and what it is.
  const words=r=>[r.name,...(r.aliases||[]),...(r.tags||[]),r.family,r.short,ENTRIES[r.entry],r.category].join(' ').toLowerCase().replace(/[^a-z0-9]+/g,' ');
  // Each record's picture as a DeckDeviceArt.PHOTOS entry (mech:lib:<id> -> [page, credit, {image}]), so the app reads it
  // once through the photo folder like every other card's: the window itself loads no image from the internet.
  const photos=records=>Object.fromEntries((records||[]).filter(r=>r?.image?.page).map(r=>['mech:lib:'+r.id,[r.image.page,r.image.credit||'',...(r.image.src?[{image:r.image.src}]:[])]]));
  // Where a record is used, as the picker's season filter says it: biobuzz, general or historical.
  const seasonsOf=r=>[...new Set((r.seasons||[]).map(s=>String(s).split(':')[0]))];
  return {CATEGORIES,ENTRIES,IMAGES,REFS,ACTUATION,DIFFICULTY,STATUS,LEGALITY,CONFIDENCE,problems,validate,words,photos,seasonsOf};
});
