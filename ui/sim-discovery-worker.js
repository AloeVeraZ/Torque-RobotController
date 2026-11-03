// Looks through a CAD body off the page's thread, so a big robot does not stall the page: finding its moving parts
// (DeckDiscovery), and sweeping a moving part through its range for contacts (DeckCollide, also the range of motion test). The body's arrays come
// with each request; the last body's prepared form is kept for the next one.
importScripts('sim-kinematics.js','sim-mechanisms.js','sim-mechanism-types.js','sim-discovery.js','sim-collide.js');
let last=null;
onmessage=e=>{
  const {id,op='discover',key,arrays,options}=e.data;
  try{const t=performance.now();if(!last||last.key!==key||arrays)last={key,ctx:DeckDiscovery.prepare(arrays)};const ctx=last.ctx;
    if(op==='sweep'){const model=DeckKinematics.sanitize(options.model),s=DeckCollide.sweep(ctx,model,options.joint,options);
      postMessage({id,ok:true,free:s.free,hits:s.hits.map(h=>({at:h.at,parts:h.parts,names:[...new Set(h.parts.flatMap(([a,b])=>[ctx.parts.name(a),ctx.parts.name(b)]))].slice(0,4)})),ms:performance.now()-t});return;}
    if(op==='motion'){postMessage({id,ok:true,...DeckCollide.job(ctx,DeckKinematics.sanitize(options.model),options),ms:performance.now()-t});return;}
    const out=DeckDiscovery.discover(ctx,options);postMessage({id,ok:true,joints:out.joints,couplings:out.couplings,report:out.report,intakes:out.intakes,ms:performance.now()-t});}
  catch(err){postMessage({id,ok:false,error:err.message});}
};
