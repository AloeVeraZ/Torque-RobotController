(function(root,factory){const value=factory(root);if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckCollide=value;})(typeof globalThis==='object'?globalThis:this,root=>{
  'use strict';
  // Does a moving part hit anything as it moves? Each part (leaf) of the CAD is wrapped in a box along its own principal
  // axes (an oriented box); posing the robot moves the boxes of each link, and two boxes overlap when no axis separates
  // them (the separating axis test). Only contacts that are new are reported: parts that touch or overlap in the CAD's
  // own pose (bolted together, an axle in its bearing) are assembled that way and not counted. Boxes are bigger than the
  // parts they wrap, so a reported contact means the parts come within a box's slack of each other: worth a look, not
  // a guaranteed collision. Kinematic only: nothing is pushed or stopped.
  const K=()=>root.DeckKinematics||(typeof require==='function'?require('./sim-kinematics.js'):null),D=()=>root.DeckDiscovery||(typeof require==='function'?require('./sim-discovery.js'):null);
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  // A part's boxes: one along the CAD's axes and one along the part's principal axes (centre, three unit axes, half sizes,
  // and the radius of a ball holding it). The part lies inside both, so two parts can touch only where every box of one
  // meets every box of the other: a plate with a slanted outline has diagonal principal axes whose box overhangs its
  // corners, and the other box trims that.
  function boxOf(ctx,k){
    const key='obb:'+k;if(ctx.cache.has(key))return ctx.cache.get(key);const f=D().feature(ctx,k);if(!f){ctx.cache.set(key,null);return null;}
    const v=ctx.vertsOf(k),fit=A=>{const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<v.length;i++){const p=ctx.P(v[i]);for(let a=0;a<3;a++){const d=dot(p,A[a]);if(d<lo[a])lo[a]=d;if(d>hi[a])hi[a]=d;}}
      const h=[0,1,2].map(a=>(hi[a]-lo[a])/2),mid=[0,1,2].map(a=>(hi[a]+lo[a])/2),c=[0,1,2].map(i=>A[0][i]*mid[0]+A[1][i]*mid[1]+A[2][i]*mid[2]);return {c,A,h,r:Math.hypot(...h),volume:h[0]*h[1]*h[2]};};
    const box=[fit([[1,0,0],[0,1,0],[0,0,1]]),fit(f.axes)];ctx.cache.set(key,box);return box;
  }
  // A part's boxes moved by a rigid motion W (4×4, column-major).
  function moved(boxes,W){const M=K().math;return boxes.map(b=>({c:M.apply(W,b.c),A:b.A.map(a=>M.applyDir(W,a)),h:b.h,r:b.r}));}
  // Two parts may touch only when every box of one overlaps every box of the other.
  const touch=(a,b,tol)=>a.every(x=>b.every(y=>overlap(x,y,tol)));
  // Separating axis test for two oriented boxes, with a little slack (tol) so touching faces do not count.
  function overlap(a,b,tol=0){
    const d=[b.c[0]-a.c[0],b.c[1]-a.c[1],b.c[2]-a.c[2]];if(Math.hypot(...d)>a.r+b.r-tol)return false;
    const axes=[...a.A,...b.A];for(const u of a.A)for(const w of b.A){const x=cross(u,w),l=Math.hypot(...x);if(l>1e-6)axes.push(x.map(v=>v/l));}
    for(const n of axes){const ra=a.h[0]*Math.abs(dot(a.A[0],n))+a.h[1]*Math.abs(dot(a.A[1],n))+a.h[2]*Math.abs(dot(a.A[2],n)),rb=b.h[0]*Math.abs(dot(b.A[0],n))+b.h[1]*Math.abs(dot(b.A[1],n))+b.h[2]*Math.abs(dot(b.A[2],n));
      if(Math.abs(dot(d,n))>ra+rb-tol)return false;}
    return true;
  }
  // Which link each part belongs to (the deepest joint naming it), or null for the robot's frame.
  function owners(ctx,model){const own=new Map(),list=K().order(model);for(const j of list)for(const k of ctx.parts.expand(j.parts))own.set(k,j.id);return own;}
  // Prepares a check of one joint: its link's parts (and its children's) against everything else. points: a contact
  // also needs a point of the moving part's own surface inside the other part's boxes, which leaves out the slack of
  // the moving part's boxes (a curved hood's boxes reach far past the hood).
  function checker(ctx,model,jointId,{tol=.01,points=false}={}){
    const own=owners(ctx,model),byId=new Map(model.joints.map(j=>[j.id,j]));
    // The moving set: the joint and the joints riding on it.
    const riding=new Set([jointId]);let grew=true;while(grew){grew=false;for(const j of model.joints)if(j.parent&&riding.has(j.parent)&&!riding.has(j.id)){riding.add(j.id);grew=true;}}
    // A part round about its own joint's axis (a turntable gear, a ring, a wheel on its axle) fills the same space as it
    // turns, so it cannot meet anything new; its box would, sweeping its corners round.
    const spins=k=>{const j=byId.get(own.get(k)),r=D().feature(ctx,k)?.revolve;return j&&(j.type==='revolute'||j.type==='continuous')&&r&&D().coaxial({axis:K().math.unit(j.axis),center:j.origin},r,Math.max(.02,r.radius*.05));};
    const mine=[],others=[];for(let k=0;k<ctx.leaves;k++){const b=boxOf(ctx,k);if(!b)continue;if(riding.has(own.get(k))){if(!spins(k))mine.push(k);}else others.push(k);}
    // Parts touching at rest are assembled that way.
    const restPairs=new Set(),rest=new Map([...mine,...others].map(k=>[k,boxOf(ctx,k)]));
    for(const a of mine)for(const b of others)if(touch(rest.get(a),rest.get(b),-tol))restPairs.add(a+':'+b);
    // Only parts near the moving set's reach can be hit.
    const M=K().math,link=byId.get(jointId),o=link.origin,reach=Math.max(...mine.map(k=>{const b=rest.get(k)[0];return M.len(M.sub(b.c,o))+b.r;}),0);
    const near=others.filter(k=>{const b=rest.get(k)[0];return M.len(M.sub(b.c,o))<=reach+b.r;});
    return {mine,near,
      // The new contacts in a pose ({jointId: value}): pairs of parts as [moving part, other part].
      at(values){const p=K().pose(model,values),hits=[],W=k=>{const id=own.get(k);return id?p.W.get(id):null;};
        const boxes=new Map();const box=k=>{if(!boxes.has(k)){const w=W(k);boxes.set(k,w?moved(rest.get(k),w):rest.get(k));}return boxes.get(k);};
        for(const a of mine)for(const b of near){if(restPairs.has(a+':'+b))continue;if(touch(box(a),box(b),tol)&&(!points||pierces(a,W(a),box(b))))hits.push([a,b]);}
        return hits;}};
    // Some of the moving part's surface points (triangle corners and centres), moved, inside every box of the other part
    // (less tol).
    function pierces(a,w,boxes){const key='pts:'+a;let pts=ctx.cache.get(key);
      if(!pts){const t=ctx.trisOf(a),step=Math.max(1,Math.floor(t.length/300));pts=[];for(let i=0;i<t.length;i+=step){const c=ctx.index3(t[i]).map(ctx.P);pts.push(...c,[0,1,2].map(n=>(c[0][n]+c[1][n]+c[2][n])/3));}ctx.cache.set(key,pts);}
      const M=K().math;for(const p of pts){const q=w?M.apply(w,p):p;if(boxes.every(b=>b.A.every((ax,i)=>Math.abs(dot([q[0]-b.c[0],q[1]-b.c[1],q[2]-b.c[2]],ax))<=b.h[i]-tol)))return true;}return false;}
  }
  // Sweeps a one-value joint from its current value toward each end (or through its named positions) in steps, and
  // reports the first contact each way: {free:[low, high] reached without contact, hits:[{at, parts}]}.
  function sweep(ctx,model,jointId,{from=0,lower=-180,upper=180,step=2,values={},points=false}={}){
    const c=checker(ctx,model,jointId,{points}),out={free:[from,from],hits:[]};
    for(const dir of [-1,1]){const end=dir<0?lower:upper;for(let q=from;dir<0?q>=end:q<=end;q+=dir*step){const hits=c.at({...values,[jointId]:q});
      if(hits.length){out.hits.push({at:+q.toFixed(2),parts:hits});break;}out.free[dir<0?0:1]=+q.toFixed(2);}}
    return out;
  }
  // ---------------------------------------------------------------- the parts' real surfaces, for the range of motion test
  // A part's triangles in a tree of boxes, built the first time something comes near it.
  function meshOf(ctx,k){
    const key='bvh:'+k;if(ctx.cache.has(key))return ctx.cache.get(key);
    const tris=ctx.trisOf(k),n=tris.length,T=new Float64Array(9*n),mid=new Float64Array(3*n),order=new Int32Array(n);
    for(let i=0;i<n;i++){const c=ctx.index3(tris[i]);for(let m=0;m<3;m++){const p=ctx.P(c[m]);for(let a=0;a<3;a++){T[9*i+3*m+a]=p[a];mid[3*i+a]+=p[a]/3;}}order[i]=i;}
    const nodes=[];
    const build=(from,to)=>{const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      for(let i=from;i<to;i++){const t=9*order[i];for(let m=0;m<3;m++)for(let a=0;a<3;a++){const v=T[t+3*m+a];if(v<lo[a])lo[a]=v;if(v>hi[a])hi[a]=v;}}
      const id=nodes.length,node={lo,hi,from,to,left:-1,right:-1};nodes.push(node);
      if(to-from>6){const size=[hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]],a=size.indexOf(Math.max(...size)),half=from+(to-from>>1);
        order.subarray(from,to).sort((x,y)=>mid[3*x+a]-mid[3*y+a]);node.left=build(from,half);node.right=build(half,to);}
      return id;};
    if(n)build(0,n);const mesh={T,order,nodes};ctx.cache.set(key,mesh);return mesh;
  }
  const sub3=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  // Does the segment p→q cross the triangle? (Möller–Trumbore)
  function pierces3(p,q,a,b,c){
    const d=sub3(q,p),e1=sub3(b,a),e2=sub3(c,a),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-14)return false;
    const f=1/det,s=sub3(p,a),u=f*dot(s,h);if(u<0||u>1)return false;const r=cross(s,e1),v=f*dot(d,r);if(v<0||u+v>1)return false;const t=f*dot(e2,r);return t>=0&&t<=1;
  }
  // The closest two segments come to each other, and a point to a triangle.
  function segSeg(p1,q1,p2,q2){
    const d1=sub3(q1,p1),d2=sub3(q2,p2),r=sub3(p1,p2),a=dot(d1,d1),e=dot(d2,d2),f=dot(d2,r),c=dot(d1,r),b=dot(d1,d2),den=a*e-b*b,cl=v=>v<0?0:v>1?1:v;
    let s=den>1e-14?cl((b*f-c*e)/den):0,t=e>1e-14?(b*s+f)/e:0;if(t<0){t=0;s=a>1e-14?cl(-c/a):0;}else if(t>1){t=1;s=a>1e-14?cl((b-c)/a):0;}
    return Math.hypot(r[0]+d1[0]*s-d2[0]*t,r[1]+d1[1]*s-d2[1]*t,r[2]+d1[2]*s-d2[2]*t);
  }
  function pointTri(p,a,b,c){
    const n=cross(sub3(b,a),sub3(c,a)),l=Math.hypot(...n);if(l<1e-14)return Infinity;const h=dot(sub3(p,a),n)/l,q=[p[0]-n[0]/l*h,p[1]-n[1]/l*h,p[2]-n[2]/l*h];
    const side=(x,y)=>dot(cross(sub3(y,x),sub3(q,x)),n)>=0;return side(a,b)&&side(b,c)&&side(c,a)?Math.abs(h):Infinity;
  }
  // Two triangles cross, or (margin > 0) come within margin of each other.
  function trisMeet(A,B,margin){
    for(let i=0;i<3;i++){if(pierces3(A[i],A[(i+1)%3],B[0],B[1],B[2])||pierces3(B[i],B[(i+1)%3],A[0],A[1],A[2]))return true;}
    if(!(margin>0))return false;
    for(let i=0;i<3;i++){if(pointTri(A[i],B[0],B[1],B[2])<=margin||pointTri(B[i],A[0],A[1],A[2])<=margin)return true;for(let j=0;j<3;j++)if(segSeg(A[i],A[(i+1)%3],B[j],B[(j+1)%3])<=margin)return true;}
    return false;
  }
  // Do two parts' surfaces meet, part a moved by Wa and part b by Wb (null: not moved)?
  function meshesMeet(ctx,a,Wa,b,Wb,margin=0){
    const M=K().math,A=meshOf(ctx,a),B=meshOf(ctx,b);if(!A.nodes.length||!B.nodes.length)return false;
    const T=Wb?(Wa?M.mul(M.invert(Wb),Wa):M.invert(Wb)):Wa||M.I4(),tri=(mesh,i,move)=>{const t=9*mesh.order[i],out=[];for(let m=0;m<3;m++){const p=[mesh.T[t+3*m],mesh.T[t+3*m+1],mesh.T[t+3*m+2]];out.push(move?M.apply(T,p):p);}return out;};
    // Box of a node of A, in B's frame, against a node of B.
    const near=(n,o)=>{const c=[(n.lo[0]+n.hi[0])/2,(n.lo[1]+n.hi[1])/2,(n.lo[2]+n.hi[2])/2],e=[n.hi[0]-c[0],n.hi[1]-c[1],n.hi[2]-c[2]];
      for(let r=0;r<3;r++){const x=T[r]*c[0]+T[4+r]*c[1]+T[8+r]*c[2]+T[12+r],w=Math.abs(T[r])*e[0]+Math.abs(T[4+r])*e[1]+Math.abs(T[8+r])*e[2];if(x+w<o.lo[r]-margin||x-w>o.hi[r]+margin)return false;}return true;};
    const stack=[0,0];
    while(stack.length){const j=stack.pop(),i=stack.pop(),n=A.nodes[i],o=B.nodes[j];if(!near(n,o))continue;
      const nLeaf=n.left<0,oLeaf=o.left<0;
      if(nLeaf&&oLeaf){for(let x=n.from;x<n.to;x++){const ta=tri(A,x,true);for(let y=o.from;y<o.to;y++)if(trisMeet(ta,tri(B,y,false),margin))return true;}continue;}
      const splitA=oLeaf||(!nLeaf&&n.to-n.from>=o.to-o.from);
      if(splitA)stack.push(n.left,j,n.right,j);else stack.push(i,o.left,i,o.right);}
    return false;
  }
  // Is a point (in the part's own frame) inside the part's closed surface? Counts crossings along a slanted ray.
  function insideMesh(mesh,p){
    if(!mesh.nodes.length)return false;const d=[1,.0137,.0071],far=1e7,q=[p[0]+d[0]*far,p[1]+d[1]*far,p[2]+d[2]*far],stack=[0];let n=0;
    while(stack.length){const node=mesh.nodes[stack.pop()];
      if(p[1]>node.hi[1]&&q[1]>node.hi[1]||p[2]>node.hi[2]&&q[2]>node.hi[2]||p[0]>node.hi[0])continue;if(p[1]<node.lo[1]&&q[1]<node.lo[1]||p[2]<node.lo[2]&&q[2]<node.lo[2])continue;
      if(node.left>=0){stack.push(node.left,node.right);continue;}
      for(let i=node.from;i<node.to;i++){const t=9*mesh.order[i],a=[mesh.T[t],mesh.T[t+1],mesh.T[t+2]],b=[mesh.T[t+3],mesh.T[t+4],mesh.T[t+5]],c=[mesh.T[t+6],mesh.T[t+7],mesh.T[t+8]];if(pierces3(p,q,a,b,c))n++;}}
    return n%2===1;
  }
  // The whole robot as rigid groups, posed together. A part round about its own joint's axis (a gear on its shaft, a
  // wheel, a flywheel) fills the same space however far it turns, so it counts as part of what its joint rides on.
  // Contacts are between real surfaces. Parts already touching at zero (a bolt in its plate, an axle in its bearing)
  // are assembled that way and count only when one is pushed further into the other (an arm resting on a stop and told
  // to go through it). Belts, chains and cables bend to fit, so they are left out; the page says so.
  function scene(ctx,model,{gap=.08}={}){
    const key=JSON.stringify(model);if(ctx.cache.get('scene:key')===key)return ctx.cache.get('scene');
    const M=K().math,own=owners(ctx,model),byId=new Map(model.joints.map(j=>[j.id,j])),unitIn=model.unit||1,restGap=gap/unitIn;
    const spins=k=>{const j=byId.get(own.get(k)),r=D().feature(ctx,k)?.revolve;return j&&(j.type==='revolute'||j.type==='continuous')&&r&&D().coaxial({axis:M.unit(j.axis),center:j.origin},r,Math.max(.02/unitIn,r.radius*.05));};
    const parts=[],linkOf=new Map(),flexible=[];for(let k=0;k<ctx.leaves;k++){if(!boxOf(ctx,k))continue;if(FLEXIBLE.test(ctx.parts.name(k))){flexible.push(k);continue;}parts.push(k);const id=own.get(k);linkOf.set(k,id?(spins(k)?byId.get(id).parent:id):null);}
    const links=new Map();for(const k of parts){const id=linkOf.get(k);if(!links.has(id))links.set(id,[]);links.get(id).push(k);}
    const rest=new Map(parts.map(k=>[k,boxOf(ctx,k)]));
    const restTouch=new Map(),inRest=new Map();
    const touching=(a,b)=>{const pk=a<b?a+':'+b:b+':'+a;let v=restTouch.get(pk);if(v===undefined){v=touch(rest.get(a),rest.get(b),-restGap)&&meshesMeet(ctx,a,null,b,null,restGap);restTouch.set(pk,v);}return v;};
    // Some of a part's corners, and which of them are inside the other part at zero already (modelled overlap).
    const samples=k=>{const key2='samples:'+k;let s=ctx.cache.get(key2);if(!s){const v=ctx.vertsOf(k),st=Math.max(1,Math.floor(v.length/120));s=[];for(let i=0;i<v.length;i+=st)s.push(ctx.P(v[i]));ctx.cache.set(key2,s);}return s;};
    const startInside=(a,b)=>{const pk=a+'>'+b;let m=inRest.get(pk);if(!m){const mesh=meshOf(ctx,b);m=samples(a).map(p=>insideMesh(mesh,p));inRest.set(pk,m);}return m;};
    const pushedIn=(a,Wa,b,Wb)=>{const mesh=meshOf(ctx,b),T=Wb?M.mul(M.invert(Wb),Wa||M.I4()):Wa||M.I4(),start=startInside(a,b),pts=samples(a);
      for(let i=0;i<pts.length;i++){if(start[i])continue;const q=M.apply(T,pts[i]);if(M.len(M.sub(q,pts[i]))<3*restGap)continue;if(insideMesh(mesh,q))return true;}return false;};
    const same=(x,y)=>{if(x===y)return true;for(let i=0;i<16;i++)if(Math.abs((x?x[i]:i%5===0?1:0)-(y?y[i]:i%5===0?1:0))>1e-9)return false;return true;};
    const sphere=(list)=>{const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const k of list){const b=rest.get(k)[0];for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],b.c[a]-b.r);hi[a]=Math.max(hi[a],b.c[a]+b.r);}}const c=[0,1,2].map(a=>(lo[a]+hi[a])/2);return {c,r:Math.hypot(hi[0]-c[0],hi[1]-c[1],hi[2]-c[2])};};
    const spheres=new Map([...links].map(([id,list])=>[id,sphere(list)]));
    const toothed=k=>TOOTHED.test(ctx.parts.name(k));
    const out={parts,linkOf,links,flexible,touching,
      // The joints riding on this one (itself too).
      riding(jointId){const set=new Set([jointId]);let grew=true;while(grew){grew=false;for(const j of model.joints)if(j.parent&&set.has(j.parent)&&!set.has(j.id)){set.add(j.id);grew=true;}}return set;},
      // How far this joint's moving parts are from its axis, in inches: how fast they sweep per degree.
      reach(jointId){const j=byId.get(jointId),set=out.riding(jointId),a=M.unit(j.axis);let far=0;for(const k of parts){if(!set.has(linkOf.get(k)))continue;const b=rest.get(k)[0],d=M.sub(b.c,j.origin),along=M.scale(a,M.dot(d,a));far=Math.max(far,M.len(M.sub(d,along))+b.r);}return far*unitIn;},
      moves(jointId){const set=out.riding(jointId);return parts.some(k=>set.has(linkOf.get(k)));},
      // Every new contact in a pose ({jointId: value}), as [part, part].
      at(values){
        const p=K().pose(model,values),W=id=>id?p.W.get(id)||null:null,hits=[],ids=[...links.keys()];
        const boxes=new Map(),box=(k,w)=>{let b=boxes.get(k);if(!b){b=w?moved(rest.get(k),w):rest.get(k);boxes.set(k,b);}return b;};
        for(let x=0;x<ids.length;x++){const wx=W(ids[x]),sx=spheres.get(ids[x]),cx=wx?M.apply(wx,sx.c):sx.c;
          for(let y=x+1;y<ids.length;y++){const wy=W(ids[y]);if(same(wx,wy))continue;const sy=spheres.get(ids[y]),cy=wy?M.apply(wy,sy.c):sy.c;if(M.len(M.sub(cx,cy))>sx.r+sy.r)continue;
            const lx=links.get(ids[x]),ly=links.get(ids[y]);
            for(const a of lx){const ba=box(a,wx),ca=ba[0].c,ra=ba[0].r;if(M.len(M.sub(ca,cy))>ra+sy.r)continue;
              for(const b of ly){const bb=box(b,wy);if(M.len(M.sub(ca,bb[0].c))>ra+bb[0].r||!touch(ba,bb,0))continue;
                if((toothed(a)||toothed(b))&&touching(a,b))continue;if(touching(a,b)?(pushedIn(a,wx,b,wy)||pushedIn(b,wy,a,wx)):meshesMeet(ctx,a,wx,b,wy,0))hits.push([a,b]);}}}}
        return hits;}};
    ctx.cache.set('scene:key',key);ctx.cache.set('scene',out);return out;
  }
  const TOOTHED=/gear|pinion|sprocket|pulley|\brack\b|\bspur\b/i;
  const FLEXIBLE=/\b(belts?|chains?|cables?|wires?|wiring|string|spectra|zip.?ties?)\b/i;
  const nameOfPart=(ctx,k)=>String(ctx.parts.name(k)).replace(/\s*<\d+>$/,'');
  // One joint's value through its whole range, outward from zero each way. A part that has been round once has seen every
  // angle, so a cap past a full turn is only swept that far (unless something geared to it keeps changing). Returns
  // how far it is clear each way, and each pair of parts that meet with where they first and last do.
  function rangeSweep(ctx,model,{joint,lower,upper,index=0,linear=false,values={},gap}={}){
    const sc=scene(ctx,model,{gap}),j=model.joints.find(x=>x.id===joint),n=K().dofOf(j).length;
    if(!sc.moves(joint))return {joint,spins:true,free:[lower,upper],hits:[],samples:0};
    const geared=model.couplings.some(c=>c.from===joint),turn=!linear&&!geared?360:Infinity;
    const step=linear?.25:Math.max(.5,Math.min(3,.25/Math.max(.1,sc.reach(joint))*180/Math.PI));
    const from=Math.max(lower,Math.min(upper,0)),set=q=>{const v=Array.from({length:n},(_,i)=>i===index?q:0);return {...values,[joint]:n===1?q:v};};
    const pairs=new Map(),free=[from,from];let samples=0,failed=[false,false];
    const look=q=>{samples++;const hits=sc.at(set(q));for(const [a,b] of hits){const pk=a+':'+b;let h=pairs.get(pk);if(!h){h={a,b,first:q,last:q,low:q<from,high:q>from};pairs.set(pk,h);}h.last=q;h.low||=q<from;h.high||=q>from;if(Math.abs(q)<Math.abs(h.first))h.first=q;}return hits.length>0;};
    if(look(from))failed=[true,true];
    for(const [i,dir] of [[0,-1],[1,1]]){if(failed[i])continue;const end=dir<0?Math.max(lower,from-turn):Math.min(upper,from+turn);if(dir<0?end>=from:end<=from)continue;
      let q=from,was=from;
      for(;;){q=dir<0?Math.max(end,q-step):Math.min(end,q+step);
        if(look(q)){let lo=was,hi=q;for(let t=0;t<5&&Math.abs(hi-lo)>(linear?.02:.1);t++){const m=(lo+hi)/2;if(look(m))hi=m;else lo=m;}free[i]=+lo.toFixed(2);failed[i]=true;
          // Still walk the rest of the way for what else it meets.
          for(;q!==end;){q=dir<0?Math.max(end,q-step*2):Math.min(end,q+step*2);look(q);}break;}
        was=q;if(q===end){free[i]=+q.toFixed(2);break;}}}
    // Past a full turn with nothing met, it is clear all the way to its cap.
    if(!failed[0]&&free[0]===Math.max(lower,from-turn))free[0]=lower;if(!failed[1]&&free[1]===Math.min(upper,from+turn))free[1]=upper;
    // Parts touching at zero that keep meeting whichever way it goes run against each other (a bearing, a rail, a wheel on
    // its track) rather than block it. Only ends that met something else limit how far it is clear.
    const all=[...pairs.values()],slides=h=>sc.touching(h.a,h.b)&&h.low&&h.high,real=all.filter(h=>!slides(h));
    const near=dir=>{const qs=real.flatMap(h=>[h.first,h.last]).filter(q=>dir<0?q<from:q>from);return qs.length?(dir<0?Math.max(...qs):Math.min(...qs)):null;};
    if(failed[0]&&!real.some(h=>h.first<from||h.last<from))free[0]=lower;else if(failed[0]&&near(-1)!==null&&near(-1)<free[0])free[0]=+near(-1).toFixed(2);
    if(failed[1]&&!real.some(h=>h.first>from||h.last>from))free[1]=upper;else if(failed[1]&&near(1)!==null&&near(1)>free[1])free[1]=+near(1).toFixed(2);
    const hits=real.sort((x,y)=>Math.abs(x.first)-Math.abs(y.first)).map(h=>({a:h.a,b:h.b,first:+h.first.toFixed(2),last:+h.last.toFixed(2),names:[nameOfPart(ctx,h.a),nameOfPart(ctx,h.b)]}));
    return {joint,free,hits,samples,step:+step.toFixed(2),sliding:all.length-real.length};
  }
  // The joints whose swept spaces reach each other, or that ride on each other: only they can meet in a combination that
  // neither shows by itself.
  function combos(ctx,model,items,{gap}={}){
    const sc=scene(ctx,model,{gap}),M=K().math,spaces=new Map();
    for(const it of items){if(!sc.moves(it.joint))continue;const set=sc.riding(it.joint),list=sc.parts.filter(k=>set.has(sc.linkOf.get(k))),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      for(let s=0;s<=6;s++){const q=it.lower+(it.upper-it.lower)*s/6,p=K().pose(model,{[it.joint]:q});
        for(const k of list){const b=boxOf(ctx,k)[0],w=p.W.get(sc.linkOf.get(k)),c=w?M.apply(w,b.c):b.c;for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],c[a]-b.r);hi[a]=Math.max(hi[a],c[a]+b.r);}}}
      spaces.set(it.joint,{lo,hi,set});}
    const out=[],ids=[...spaces.keys()];
    for(let x=0;x<ids.length;x++)for(let y=x+1;y<ids.length;y++){const A=spaces.get(ids[x]),B=spaces.get(ids[y]),rides=A.set.has(ids[y])||B.set.has(ids[x]),reach=[0,1,2].every(a=>A.lo[a]<=B.hi[a]&&B.lo[a]<=A.hi[a]);if(rides||reach)out.push([ids[x],ids[y]]);}
    return out;
  }
  // Two joints through their ranges together, on a grid, for contacts that neither makes by itself (ignore: "a:b" pairs
  // their own sweeps already found).
  function pairSweep(ctx,model,{a,b,ignore=[],values={},gap,cells=12}={}){
    const sc=scene(ctx,model,{gap}),skip=new Set(ignore),found=new Map(),grid=it=>{const span=Math.min(it.upper-it.lower,it.linear?Infinity:360),n=Math.max(2,Math.min(cells,Math.ceil(span/(it.linear?1:15))));return Array.from({length:n+1},(_,i)=>+(it.lower+span*i/n).toFixed(3));};
    // A contact either makes with the other left at zero is that one's own, not the combination's.
    const alone=(id,q)=>{const key=id+'@'+q;if(!lines.has(key))lines.set(key,new Set(sc.at({...values,[id]:q}).map(([p,o])=>p+':'+o)));return lines.get(key);},lines=new Map();
    let samples=0;for(const x of grid(a))for(const y of grid(b)){samples++;for(const [p,q] of sc.at({...values,[a.joint]:x,[b.joint]:y})){const pk=p+':'+q;if(skip.has(pk)||skip.has(q+':'+p)||found.has(pk)||alone(a.joint,x).has(pk)||alone(b.joint,y).has(pk))continue;found.set(pk,{a:p,b:q,at:{[a.joint]:x,[b.joint]:y},names:[nameOfPart(ctx,p),nameOfPart(ctx,q)]});}}
    return {hits:[...found.values()],samples};
  }
  // One piece of the range of motion test, as the worker runs it.
  function job(ctx,model,o){
    if(o.job==='range')return rangeSweep(ctx,model,o);if(o.job==='combos')return {pairs:combos(ctx,model,o.items)};if(o.job==='pair')return pairSweep(ctx,model,o);throw new Error('unknown job '+o.job);
  }
  return {boxOf,moved,overlap,touch,checker,sweep,scene,rangeSweep,combos,pairSweep,job,meshesMeet,insideMesh,meshOf};
});
