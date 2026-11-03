'use strict';
// Split a STEP (ISO 10303-21) file into smaller STEP files that can be read in parallel. Nearly all of a
// robot assembly's size is solid geometry; every piece keeps the whole assembly structure (products,
// placements, units, colours) and only some of the solids, so OpenCascade still places and colours each
// part and the pieces' meshes add up to the whole robot.
const SOLIDS=new Set(['MANIFOLD_SOLID_BREP','BREP_WITH_VOIDS','FACETED_BREP','SHELL_BASED_SURFACE_MODEL','TESSELLATED_SOLID','TESSELLATED_SHELL','TRIANGULATED_FACE','COMPLEX_TRIANGULATED_FACE','TRIANGULATED_SURFACE_SET','COMPLEX_TRIANGULATED_SURFACE_SET']);
// Topology that belongs to a solid: a colour or layer on one of these is left out of pieces without that solid.
const TOPOLOGY=new Set([...SOLIDS,'CLOSED_SHELL','OPEN_SHELL','ORIENTED_CLOSED_SHELL','ADVANCED_FACE','FACE_SURFACE','ORIENTED_FACE','FACE_BOUND','FACE_OUTER_BOUND','EDGE_LOOP','ORIENTED_EDGE','EDGE_CURVE','VERTEX_POINT','VERTEX_LOOP','POLY_LOOP']);
const digit=c=>c>=48&&c<=57;
// Entities as typed arrays: id, text span in the DATA section, type code and the entities (indices) referred to.
function parse(text){
  const data=text.indexOf('DATA;'),end=text.lastIndexOf('ENDSEC;');if(data<0||end<data)throw Error('That is not a STEP file.');
  let cap=1<<16,n=0,ids=new Int32Array(cap),starts=new Int32Array(cap),ends=new Int32Array(cap),types=new Uint16Array(cap),refAt=new Int32Array(cap+1);
  let rcap=1<<18,rn=0,refIds=new Int32Array(rcap);const typeCode=new Map(),typeNames=[];
  const grow=(a,size)=>{const b=new a.constructor(size);b.set(a);return b;};
  let i=data+5;
  while(i<end){
    const hash=text.indexOf('#',i);if(hash<0||hash>=end)break;
    let j=hash+1,id=0,c;while(digit(c=text.charCodeAt(j))){id=id*10+c-48;j++;}
    while(text.charCodeAt(j)<=32)j++;if(text.charCodeAt(j)!==61){i=j;continue;}j++;
    while(text.charCodeAt(j)<=32)j++;let t=j;while((c=text.charCodeAt(t))>=65&&c<=90||digit(c)||c===95)t++;
    const type=text.slice(j,t);let code=typeCode.get(type);if(code===undefined){code=typeNames.length;typeCode.set(type,code);typeNames.push(type);}
    if(n===cap){cap*=2;ids=grow(ids,cap);starts=grow(starts,cap);ends=grow(ends,cap);types=grow(types,cap);refAt=grow(refAt,cap+1);}
    refAt[n]=rn;let q=false;
    for(;j<end;j++){c=text.charCodeAt(j);if(c===39)q=!q;else if(!q){if(c===59)break;if(c===35){let k=j+1,v=0;while(digit(c=text.charCodeAt(k))){v=v*10+c-48;k++;}if(k>j+1){if(rn===rcap){rcap*=2;refIds=grow(refIds,rcap);}refIds[rn++]=v;}j=k-1;}}}
    ids[n]=id;starts[n]=hash;ends[n]=j+1;types[n]=code;n++;i=j+1;
  }
  refAt[n]=rn;
  let max=0;for(let k=0;k<n;k++)if(ids[k]>max)max=ids[k];
  const index=new Int32Array(max+1).fill(-1);for(let k=0;k<n;k++)index[ids[k]]=k;
  // References as entity indices (-1 when the id is not defined).
  const refs=new Int32Array(rn);for(let r=0;r<rn;r++)refs[r]=refIds[r]<=max?index[refIds[r]]:-1;
  return {text,head:text.slice(0,data+5),tail:text.slice(end),n,ids,starts,ends,types,typeNames,refAt,refs,index};
}
// The entity text without its references to `gone` inside lists; null when one is a direct attribute (the
// entity cannot stand without it) or a list is left empty (OpenCascade rejects "()").
function filterRefs(body,gone){
  const eq=body.indexOf('=');let j=eq+1;while(body.charCodeAt(j)<=32)j++;
  const attrDepth=body[j]==='('?2:1;let out=body.slice(0,j),last=j,depth=0,q=false;
  for(;j<body.length;j++){const c=body.charCodeAt(j);
    if(c===39){q=!q;continue;}if(q)continue;
    if(c===40){depth++;continue;}if(c===41){depth--;continue;}
    if(c!==35)continue;let k=j+1,v=0,d;while(digit(d=body.charCodeAt(k))){v=v*10+d-48;k++;}
    if(!gone.has(v)){j=k-1;continue;}if(depth<=attrDepth)return null;
    let next=k;while(body.charCodeAt(next)<=32)next++;
    const prior=(out+body.slice(last,j)).replace(/\s+$/,'');
    if(prior.endsWith('(')&&body[next]===')')return null;
    if(body[next]===','){out+=body.slice(last,j);last=next+1;}else{out=prior.endsWith(',')?prior.slice(0,-1):prior;last=k;}
    j=last-1;}
  return out+body.slice(last);
}
// Plans up to `count` pieces of similar size; piece(p) builds piece p's STEP text when it is needed.
// With `exact` (bytes), solids are read exactly smallest first up to that much geometry; heavier ones (above
// HULL_MIN) become their convex hull: a marker solid in the piece, swapped for shapes[i] after reading
// (step-hull.cjs). Infinity reads everything exactly.
const HULL_MIN=150*1024,HULL_BYTES=2*1024;
function plan(text,count,{exact=Infinity}={}){
  const s=parse(text),{n,refAt,refs,types,typeNames}=s,solid=new Uint8Array(typeNames.length),topo=new Uint8Array(typeNames.length);
  typeNames.forEach((t,c)=>{solid[c]=SOLIDS.has(t)?1:0;topo[c]=TOPOLOGY.has(t)?1:0;});
  const roots=[];for(let k=0;k<n;k++)if(solid[types[k]])roots.push(k);
  // Each solid's geometry size (shared geometry counted once) and everything solids reach.
  const geometry=new Uint8Array(n),sizes=new Float64Array(roots.length),stack=[];
  roots.forEach((root,r)=>{stack.push(root);while(stack.length){const k=stack.pop();if(geometry[k])continue;geometry[k]=1;sizes[r]+=s.ends[k]-s.starts[k];for(let x=refAt[k];x<refAt[k+1];x++){const y=refs[x];if(y>=0&&!geometry[y])stack.push(y);}}});
  const hulls=new Map(),shapes=[];let next=s.ids.reduce((m,v)=>Math.max(m,v),0)+1;
  if(Number.isFinite(exact)){const {solidPoints,hull,markerStep}=require('./step-hull.cjs');let used=0;
    for(const r of [...roots.keys()].sort((a,b)=>sizes[a]-sizes[b])){if(used+sizes[r]<=exact||sizes[r]<HULL_MIN){used+=sizes[r];continue;}
      const h=hull(solidPoints(s,roots[r]));if(!h){used+=sizes[r];continue;}
      const k=roots[r],name=/'((?:[^']|'')*)'/.exec(text.slice(s.starts[k],s.ends[k]))?.[1]?.replace(/''/g,"'")||'',out=markerStep(s.ids[k],name,shapes.length,next);next=out.next;shapes.push(h);hulls.set(r,out.text);sizes[r]=HULL_BYTES;}}
  if(roots.length<2||count<2){if(!hulls.size)return {count:1,solids:roots.length,hulls:0,shapes,entities:n,loads:[1],piece:()=>text};count=1;}
  const pieces=Math.max(1,Math.min(count,roots.length)),load=new Float64Array(pieces),of=new Int32Array(roots.length);
  for(const r of [...roots.keys()].sort((a,b)=>sizes[b]-sizes[a])){let best=0;for(let p=1;p<pieces;p++)if(load[p]<load[best])best=p;of[r]=best;load[best]+=sizes[r];}
  const hullText=new Map([...hulls].map(([r,t])=>[roots[r],t]));
  const shared=[];for(let k=0;k<n;k++)if(!geometry[k])shared.push(k);
  // The top entities (nothing refers to them: the products, their shapes and placements, the colour lists): a piece keeps
  // only what it reaches from them, so the styles of other pieces' faces stay out of it.
  const referred=new Uint8Array(n);for(let r=0;r<refs.length;r++)if(refs[r]>=0)referred[refs[r]]=1;
  const tops=shared.filter(k=>!referred[k]);
  const slice=k=>text.slice(s.starts[k],s.ends[k]);
  function piece(p){
    const inside=new Uint8Array(n),reach=x=>{stack.push(x);while(stack.length){const k=stack.pop();if(inside[k])continue;inside[k]=1;for(let z=refAt[k];z<refAt[k+1];z++){const y=refs[z];if(y>=0&&!inside[y])stack.push(y);}}};
    roots.forEach((root,r)=>{if(of[r]!==p)return;if(hulls.has(r))inside[root]=2;else reach(root);});
    // Shared entities (assembly, units, colours) that refer to other pieces' topology lose those list entries, or
    // go (a colour on one face); plain geometry they use (a placement, a direction) comes along.
    const absent=new Set();
    for(const k of shared)for(let z=refAt[k];z<refAt[k+1];z++){const y=refs[z];if(y<0||!geometry[y]||inside[y])continue;if(topo[types[y]])absent.add(s.ids[y]);else reach(y);}
    const body=new Map(),touches=k=>{for(let z=refAt[k];z<refAt[k+1];z++){const y=refs[z];if(y>=0&&absent.has(s.ids[y]))return true;}return false;};
    let changed=absent.size>0;
    while(changed){changed=false;
      for(const k of shared){const was=body.get(k);if(was===null||!touches(k))continue;
        const t=filterRefs(was??slice(k),absent);
        if(t===null){body.set(k,null);absent.add(s.ids[k]);changed=true;}else if(t!==was)body.set(k,t);}}
    // What the piece keeps: everything its top entities still reach. A style left only on other pieces' faces goes, so
    // OpenCascade reads each piece's own colours and assembly, not every part's (most of a big robot's non-solid entities).
    const live=new Uint8Array(n),queue=[],keep=y=>y>=0&&!live[y]&&(geometry[y]?inside[y]>0:body.get(y)!==null);
    for(const k of tops)if(keep(k)){live[k]=1;queue.push(k);}
    while(queue.length){const k=queue.pop();if(inside[k]===2)continue;const b=body.get(k);
      if(typeof b==='string'){for(const m of b.slice(b.indexOf('=')+1).matchAll(/#(\d+)/g)){const id=+m[1],y=id<s.index.length?s.index[id]:-1;if(keep(y)){live[y]=1;queue.push(y);}}}
      else for(let z=refAt[k];z<refAt[k+1];z++){const y=refs[z];if(keep(y)){live[y]=1;queue.push(y);}}}
    const parts=[s.head];
    for(let k=0;k<n;k++){if(!live[k])continue;if(geometry[k]){parts.push(inside[k]===2?hullText.get(k):slice(k));continue;}const b=body.get(k);parts.push(b??slice(k));}
    parts.push(s.tail);return parts.join('\n');
  }
  return {count:pieces,solids:roots.length,hulls:hulls.size,shapes,entities:n,loads:[...load],piece};
}
module.exports={parse,plan,filterRefs};
