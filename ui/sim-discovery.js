(function(root,factory){const value=factory(root);if(typeof module==='object'&&module.exports)module.exports=value;else root.DeckDiscovery=value;})(typeof globalThis==='object'?globalThis:this,root=>{
  'use strict';
  // Finding what moves in a CAD robot. A STEP file from Onshape, SolidWorks or Fusion keeps its assembly tree and part
  // names but not its mates, so joints are inferred from geometry and names, never assumed. Every proposal says how sure
  // it is and why: "metadata" (the file defined the joint), "inferred" with a confidence, and what still needs the team.
  // The evidence used:
  //   * round parts (gears, bearings, shafts, wheels, hubs): a part whose surface is a body of revolution has an axis;
  //     its principal axes give candidates and the outline around each is checked for roundness;
  //   * parts that share an axis (coaxial) turn together or carry a shaft: a pivot is where hinge hardware lines up;
  //   * names ("Rhino wheel", "Servo Hub Shaft", "Hood", "Turntable gear");
  //   * contact between parts' boxes, to tell a swinging arm from the frame that holds it;
  //   * the floor, to find how far a ramp folds before it touches down.
  // Works on plain arrays (positions, index, the part of each vertex, the assembly tree), so it runs in tests and in the
  // page alike. Frames: the CAD file's own frame and units; `rows` (robot front, left and top as CAD axes) and `unit`
  // (inches per CAD unit) say how the robot sits.
  const M=()=>root.DeckKinematics||(typeof require==='function'?require('./sim-kinematics.js'):null);
  const finite=Number.isFinite,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],scale=(a,s)=>[a[0]*s,a[1]*s,a[2]*s],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=a=>Math.hypot(a[0],a[1],a[2]),unit=a=>{const l=len(a);return l>1e-12?scale(a,1/l):[0,0,1];};
  const perpendicular=a=>{const u=unit(a),w=Math.abs(u[0])<.6?[1,0,0]:Math.abs(u[1])<.6?[0,1,0]:[0,0,1];return unit(cross(u,w));};
  // Distance from point p to the line through o along unit a.
  const lineDistance=(p,o,a)=>{const d=sub(p,o);return len(sub(d,scale(a,dot(d,a))));};
  // ---------------------------------------------------------------- the body, part by part
  // Triangles and vertices of each part (leaf), in compressed lists.
  function prepare({positions,index,part,normals,tree}){
    const n=positions.length/3,tris=index?index.length/3:n/3,leafOf=v=>Math.round(part[v]);let leaves=0;for(let v=0;v<n;v++)if(leafOf(v)+1>leaves)leaves=leafOf(v)+1;
    leaves=Math.max(leaves,(tree?.leaf||[]).length);
    const tStart=new Int32Array(leaves+1),vStart=new Int32Array(leaves+1),corner=t=>index?index[3*t]:3*t;
    for(let t=0;t<tris;t++)tStart[leafOf(corner(t))+1]++;for(let v=0;v<n;v++)vStart[leafOf(v)+1]++;
    for(let k=0;k<leaves;k++){tStart[k+1]+=tStart[k];vStart[k+1]+=vStart[k];}
    const tList=new Int32Array(tris),vList=new Int32Array(n),tFill=tStart.slice(0,leaves),vFill=vStart.slice(0,leaves);
    for(let t=0;t<tris;t++)tList[tFill[leafOf(corner(t))]++]=t;for(let v=0;v<n;v++)vList[vFill[leafOf(v)]++]=v;
    const index3=t=>index?[index[3*t],index[3*t+1],index[3*t+2]]:[3*t,3*t+1,3*t+2],P=v=>[positions[3*v],positions[3*v+1],positions[3*v+2]];
    const ctx={positions,index,part,normals,tree,leaves,P,index3,cache:new Map(),
      trisOf:k=>tList.subarray(tStart[k],tStart[k+1]),vertsOf:k=>vList.subarray(vStart[k],vStart[k+1]),
      parts:M().partIndex(tree||{nodes:[],leaf:[]})};
    // Whole-body bounds.
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let v=0;v<n;v++)for(let c=0;c<3;c++){const x=positions[3*v+c];if(x<lo[c])lo[c]=x;if(x>hi[c])hi[c]=x;}ctx.lo=lo;ctx.hi=hi;
    return ctx;
  }
  // A part's name as the team gave it, without its instance number ("Flywheel <1>" is a "Flywheel").
  const nameOf=(ctx,k)=>String(ctx.parts.name(k)).replace(/\s*<\d+>$/,''),pathOf=(ctx,k)=>ctx.parts.key(k);
  // ---------------------------------------------------------------- one part's shape
  // Area, centre, principal axes and box; and, when its surface turns about an axis, that axis (a "revolve" feature:
  // axis, centre on it, radius, length along it, roundness 0-1).
  function feature(ctx,k){
    if(ctx.cache.has(k))return ctx.cache.get(k);const tris=ctx.trisOf(k),verts=ctx.vertsOf(k);if(!tris.length){ctx.cache.set(k,null);return null;}
    let A=0;const c=[0,0,0],S=[0,0,0,0,0,0];// S: xx xy xz yy yz zz second moments
    for(const t of tris){const [i,j,l]=ctx.index3(t),a=ctx.P(i),b=ctx.P(j),d=ctx.P(l),area=len(cross(sub(b,a),sub(d,a)))/2;if(!area)continue;A+=area;
      const s=add(add(a,b),d);for(let q=0;q<3;q++)c[q]+=area*s[q]/3;
      // ∫ x xᵀ dA over a triangle = A/12 (Σ vᵢvᵢᵀ + s sᵀ)
      const pts=[a,b,d],m=(p,q)=>pts.reduce((t,v)=>t+v[p]*v[q],0)+s[p]*s[q];S[0]+=area/12*m(0,0);S[1]+=area/12*m(0,1);S[2]+=area/12*m(0,2);S[3]+=area/12*m(1,1);S[4]+=area/12*m(1,2);S[5]+=area/12*m(2,2);}
    if(!A){ctx.cache.set(k,null);return null;}
    const g=scale(c,1/A),C=[[S[0]/A-g[0]*g[0],S[1]/A-g[0]*g[1],S[2]/A-g[0]*g[2]],[0,S[3]/A-g[1]*g[1],S[4]/A-g[1]*g[2]],[0,0,S[5]/A-g[2]*g[2]]];C[1][0]=C[0][1];C[2][0]=C[0][2];C[2][1]=C[1][2];
    const {values,vectors}=eigen(C);
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const v of verts)for(let q=0;q<3;q++){const x=ctx.positions[3*v+q];if(x<lo[q])lo[q]=x;if(x>hi[q])hi[q]=x;}
    const f={leaf:k,area:A,center:g,lo,hi,size:len(sub(hi,lo)),axes:vectors,spread:values,revolve:null};
    // A part round about an axis spreads equally in the two directions across it, so only an axis whose other two
    // spreads match is a candidate (a plate or bar has none and is skipped); of those, the roundest outline wins.
    const same=(p,q)=>Math.abs(p-q)<=.15*Math.max(p,q,1e-12),[l1,l2,l3]=values,candidates=vectors.filter((_,i)=>i===0?same(l2,l3):i===2?same(l1,l2):same(l1,l3));
    let best=null;for(const axis of candidates){const r=roundAbout(ctx,tris,g,axis);if(r&&(!best||r.roundness>best.roundness))best=r;}
    if(best&&best.roundness>=.8)f.revolve=best;
    ctx.cache.set(k,f);return f;
  }
  // How round a part's outline is about an axis through g: the farthest point in each of 24 directions around it, a
  // circle fitted to those, and the nearest/farthest ratio. Needs points all the way round (no gap wider than 75°).
  // Triangle corners and edge midpoints are both used, so a coarse outer polygon still reaches every direction (a
  // tube's inner ring would otherwise fill the directions between its outer corners).
  function roundAbout(ctx,tris,g,axis){
    const a=unit(axis),u=perpendicular(a),w=cross(a,u),bins=new Array(24).fill(null),step=Math.max(1,Math.floor(tris.length/6000));let lo=Infinity,hi=-Infinity;
    const put=q=>{const p=sub(q,g),x=dot(p,u),y=dot(p,w),h=dot(p,a),r=Math.hypot(x,y);if(h<lo)lo=h;if(h>hi)hi=h;if(r<1e-9)return;
      const b=Math.min(23,Math.floor((Math.atan2(y,x)+Math.PI)/(2*Math.PI)*24));if(!bins[b]||r>bins[b].r)bins[b]={x,y,r};};
    for(let i=0;i<tris.length;i+=step){const [i0,i1,i2]=ctx.index3(tris[i]),A=ctx.P(i0),B=ctx.P(i1),C=ctx.P(i2);put(A);put(B);put(C);put(scale(add(A,B),.5));put(scale(add(B,C),.5));put(scale(add(C,A),.5));}
    const pts=bins.filter(Boolean);if(pts.length<6)return null;
    let gap=0,last=null,first=null;bins.forEach((b,i)=>{if(!b)return;if(last!==null)gap=Math.max(gap,i-last);else first=i;last=i;});gap=Math.max(gap,first+24-last);if(gap*15>75)return null;
    const fit=fitCircle(pts);if(!fit)return null;const ds=pts.map(p=>Math.hypot(p.x-fit.x,p.y-fit.y));
    const center=add(add(g,scale(u,fit.x)),scale(w,fit.y));
    return {axis:a,center:add(center,scale(a,(lo+hi)/2)),radius:fit.r,length:hi-lo,roundness:Math.min(...ds)/Math.max(...ds)};
  }
  // Algebraic (Kåsa) circle fit through 2-D points {x,y}: centre and radius, or null when they lie on a line.
  function fitCircle(pts){
    const n=pts.length;if(n<3)return null;let mx=0,my=0;for(const p of pts){mx+=p.x;my+=p.y;}mx/=n;my/=n;
    let suu=0,svv=0,suv=0,suuu=0,svvv=0,suvv=0,svuu=0;for(const p of pts){const u=p.x-mx,v=p.y-my;suu+=u*u;svv+=v*v;suv+=u*v;suuu+=u*u*u;svvv+=v*v*v;suvv+=u*v*v;svuu+=v*u*u;}
    const det=suu*svv-suv*suv;if(Math.abs(det)<1e-18)return null;const b1=(suuu+suvv)/2,b2=(svvv+svuu)/2,uc=(b1*svv-b2*suv)/det,vc=(suu*b2-suv*b1)/det;
    return {x:uc+mx,y:vc+my,r:Math.sqrt(uc*uc+vc*vc+(suu+svv)/n)};
  }
  // Circle through many points that tolerates outliers: random triples, the one most points agree with, then refitted.
  function ransacCircle(pts,tol,{tries=300,minR=0,maxR=Infinity}={}){
    if(pts.length<3)return null;let best=null,seed=12345;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
    for(let t=0;t<tries;t++){const a=pts[Math.floor(rnd()*pts.length)],b=pts[Math.floor(rnd()*pts.length)],c=pts[Math.floor(rnd()*pts.length)],f=fitCircle([a,b,c]);if(!f||f.r<minR||f.r>maxR)continue;
      let n=0;for(const p of pts)if(Math.abs(Math.hypot(p.x-f.x,p.y-f.y)-f.r)<tol)n++;if(!best||n>best.n)best={...f,n};}
    if(!best)return null;const inliers=pts.filter(p=>Math.abs(Math.hypot(p.x-best.x,p.y-best.y)-best.r)<tol),f=fitCircle(inliers)||best;return {...f,inliers:inliers.length,share:inliers.length/pts.length};
  }
  // Whether a flattened part (triangles in a plane, each {p, x0, x1, y0, y1}) has material within r of (x, y).
  const segDist=(a,b,x,y)=>{const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,t=l?clamp(((x-a[0])*dx+(y-a[1])*dy)/l,0,1):0;return Math.hypot(a[0]+t*dx-x,a[1]+t*dy-y);};
  function near2(o,x,y,r){
    for(const t of o.T){if(x+r<t.x0||x-r>t.x1||y+r<t.y0||y-r>t.y1)continue;const [a,b,c]=t.p;
      const s1=(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]),s2=(c[0]-b[0])*(y-b[1])-(c[1]-b[1])*(x-b[0]),s3=(a[0]-c[0])*(y-c[1])-(a[1]-c[1])*(x-c[0]);
      if((s1>=0&&s2>=0&&s3>=0||s1<=0&&s2<=0&&s3<=0)&&(s1||s2||s3))return true;
      if(segDist(a,b,x,y)<=r||segDist(b,c,x,y)<=r||segDist(c,a,x,y)<=r)return true;}
    return false;}
  // How far (degrees, up to 90, in half degrees) the point q turns about c, the s way (+1 counterclockwise in the
  // plane), before a probe of radius r round it meets the flattened part; null when it meets it already.
  function swing(o,q,c,r,s){if(near2(o,q[0],q[1],r))return null;let last=0;
    for(let d=.5;d<=90;d+=.5){const t=s*d*Math.PI/180,x=c[0]+(q[0]-c[0])*Math.cos(t)-(q[1]-c[1])*Math.sin(t),y=c[1]+(q[0]-c[0])*Math.sin(t)+(q[1]-c[1])*Math.cos(t);if(near2(o,x,y,r))return last;last=d;}
    return 90;}
  // Symmetric 3×3 eigen decomposition (Jacobi): values ascending with their unit vectors.
  function eigen(A){
    const a=A.map(r=>r.slice()),v=[[1,0,0],[0,1,0],[0,0,1]];
    for(let sweep=0;sweep<50;sweep++){let off=Math.abs(a[0][1])+Math.abs(a[0][2])+Math.abs(a[1][2]);if(off<1e-15)break;
      for(const [p,q] of [[0,1],[0,2],[1,2]]){if(Math.abs(a[p][q])<1e-18)continue;const th=(a[q][q]-a[p][p])/(2*a[p][q]),t=Math.sign(th||1)/(Math.abs(th)+Math.sqrt(th*th+1)),c=1/Math.sqrt(t*t+1),s=t*c;
        for(let k=0;k<3;k++){const akp=a[k][p],akq=a[k][q];a[k][p]=c*akp-s*akq;a[k][q]=s*akp+c*akq;}for(let k=0;k<3;k++){const apk=a[p][k],aqk=a[q][k];a[p][k]=c*apk-s*aqk;a[q][k]=s*apk+c*aqk;}
        for(let k=0;k<3;k++){const vkp=v[k][p],vkq=v[k][q];v[k][p]=c*vkp-s*vkq;v[k][q]=s*vkp+c*vkq;}}}
    const order=[0,1,2].sort((i,j)=>a[i][i]-a[j][j]);return {values:order.map(i=>a[i][i]),vectors:order.map(i=>unit([v[0][i],v[1][i],v[2][i]]))};
  }
  const coaxial=(f,g,tol)=>f&&g&&Math.abs(dot(f.axis,g.axis))>Math.cos(5*Math.PI/180)&&lineDistance(g.center,f.center,f.axis)<tol;
  const parallel=(a,b,deg=8)=>Math.abs(dot(unit(a),unit(b)))>Math.cos(deg*Math.PI/180);
  // ---------------------------------------------------------------- picking a circle on the model (as a slicer measures one)
  // Clicked on a part: a round part gives its own axis. Otherwise the surface around the click decides: a curved patch
  // is fitted as a cylinder; on a flat face, the edge loop nearest the click (a hole, or the face's rim) is fitted as a
  // circle. Returns {origin, axis, radius, kind, error} in the CAD frame, or null with a reason.
  function fitAt(ctx,{leaf,point,face}){
    const f=feature(ctx,leaf);
    const tris=ctx.trisOf(leaf);if(!tris.length)return {error:'That part has no surface to measure.'};
    // Weld the part's vertices by position so neighbouring triangles find each other.
    const span=f?f.size:1,q=Math.max(1e-6,span*1e-5),keyOf=v=>`${Math.round(ctx.positions[3*v]/q)},${Math.round(ctx.positions[3*v+1]/q)},${Math.round(ctx.positions[3*v+2]/q)}`;
    const weld=new Map(),wid=v=>{const k=keyOf(v);let id=weld.get(k);if(id===undefined){id=weld.size;weld.set(k,id);}return id;};
    const T=[...tris].map(t=>{const [a,b,c]=ctx.index3(t),pa=ctx.P(a),pb=ctx.P(b),pc=ctx.P(c),n=cross(sub(pb,pa),sub(pc,pa)),area=len(n)/2;return {t,w:[wid(a),wid(b),wid(c)],p:[pa,pb,pc],n:area?scale(n,1/(2*area)):[0,0,0],area,c:scale(add(add(pa,pb),pc),1/3)};});
    const edges=new Map(),ek=(a,b)=>a<b?a+'_'+b:b+'_'+a;T.forEach((tr,i)=>{for(let e=0;e<3;e++){const k=ek(tr.w[e],tr.w[(e+1)%3]);let l=edges.get(k);if(!l)edges.set(k,l=[]);l.push(i);}});
    const neighbours=i=>{const out=[];const tr=T[i];for(let e=0;e<3;e++)for(const j of edges.get(ek(tr.w[e],tr.w[(e+1)%3])))if(j!==i)out.push(j);return out;};
    let start=-1;if(face){const want=new Set(face.map(wid));start=T.findIndex(tr=>tr.w.every(x=>want.has(x)));}
    if(start<0){let d=Infinity;T.forEach((tr,i)=>{const e=len(sub(tr.c,point));if(e<d){d=e;start=i;}});}
    const n0=T[start].n;
    // Flat: grow the coplanar face; its boundary loops are edges used once.
    const flat=new Set([start]),queue=[start],plane=dot(n0,T[start].c),tol=Math.max(q*20,span*.002);
    while(queue.length){const i=queue.pop();for(const j of neighbours(i))if(!flat.has(j)&&dot(T[j].n,n0)>Math.cos(4*Math.PI/180)&&Math.abs(dot(n0,T[j].c)-plane)<tol){flat.add(j);queue.push(j);}}
    const surface=[...flat].reduce((s,i)=>s+T[i].area,0);
    const curved=()=>{
      // A curved patch: the smooth neighbourhood of the click (normals changing little from triangle to triangle, up to a
      // third of the part's size away), its axis the direction its normals avoid.
      const reach=Math.max(span*.35,q*100),patch=new Set([start]),qq=[start];
      while(qq.length){const i=qq.pop();for(const j of neighbours(i))if(!patch.has(j)&&dot(T[j].n,T[i].n)>Math.cos(50*Math.PI/180)&&len(sub(T[j].c,point))<reach){patch.add(j);qq.push(j);}}
      const N=[[0,0,0],[0,0,0],[0,0,0]];for(const i of patch){const {n,area}=T[i];for(let r=0;r<3;r++)for(let c=0;c<3;c++)N[r][c]+=area*n[r]*n[c];}
      const {values,vectors}=eigen(N);if(values[2]<=0||values[1]/values[2]<.02)return null;const axis=vectors[0],u=perpendicular(axis),w=cross(axis,u);
      const pts=[];for(const i of patch)for(const p of T[i].p)pts.push({x:dot(p,u),y:dot(p,w),h:dot(p,axis)});
      const fit=fitCircle(pts);if(!fit)return null;const err=Math.sqrt(pts.reduce((s,p)=>s+(Math.hypot(p.x-fit.x,p.y-fit.y)-fit.r)**2,0)/pts.length);
      const h=dot(point,axis),origin=add(add(scale(u,fit.x),scale(w,fit.y)),scale(axis,h));return {origin,axis,radius:fit.r,kind:'cylinder',fitError:err/fit.r};};
    let result=null;
    if(surface>0&&flat.size>2){
      const once=[];for(const i of flat){const tr=T[i];for(let e=0;e<3;e++){const a=tr.w[e],b=tr.w[(e+1)%3],l=edges.get(ek(a,b));if(l.filter(j=>flat.has(j)).length===1)once.push([a,b,tr.p[e],tr.p[(e+1)%3]]);}}
      // Chain edges into loops.
      const next=new Map();for(const [a,b,pa,pb] of once){if(!next.has(a))next.set(a,[]);if(!next.has(b))next.set(b,[]);next.get(a).push({to:b,p:pb,from:pa});next.get(b).push({to:a,p:pa,from:pb});}
      const used=new Set(),loops=[];for(const [a,b] of once){const k=ek(a,b);if(used.has(k))continue;const loop=[];let cur=a,prev=-1;
        for(let guard=0;guard<100000;guard++){const opts=next.get(cur).filter(o=>!used.has(ek(cur,o.to)));const o=opts.find(x=>x.to!==prev)||opts[0];if(!o)break;used.add(ek(cur,o.to));loop.push(o.p);prev=cur;cur=o.to;if(cur===a)break;}
        if(loop.length>=6)loops.push(loop);}
      const u=perpendicular(n0),w=cross(n0,u),fitted=loops.map(loop=>{const pts=loop.map(p=>({x:dot(p,u),y:dot(p,w)})),fit=fitCircle(pts);if(!fit)return null;
        const err=Math.sqrt(pts.reduce((s,p)=>s+(Math.hypot(p.x-fit.x,p.y-fit.y)-fit.r)**2,0)/pts.length)/fit.r,near=Math.min(...loop.map(p=>len(sub(p,point))));
        // A circle's outline is many short edges: any four corners of a rectangle also lie on a circle.
        const longest=Math.max(...pts.map((p,i)=>{const q=pts[(i+1)%pts.length];return Math.hypot(p.x-q.x,p.y-q.y);}));return {fit,err,near,loop,round:pts.length>=8&&longest<=.65*fit.r};}).filter(x=>x&&x.round&&x.err<.06);
      fitted.sort((a,b)=>a.near-b.near);const best=fitted[0];
      if(best){const origin=add(add(scale(u,best.fit.x),scale(w,best.fit.y)),scale(n0,plane));result={origin,axis:n0,radius:best.fit.r,kind:best.fit.r<span*.3?'hole':'edge',fitError:best.err};}}
    if(!result&&f?.revolve)result={origin:f.revolve.center,axis:f.revolve.axis,radius:f.revolve.radius,kind:'part',fitError:1-f.revolve.roundness};
    if(!result)result=curved();
    if(!result||result.fitError>.08)return {error:'No circle there. Click a round part (a gear, bearing, shaft or wheel), a hole, or a round edge.'};
    // A round part's own axis beats a loose fit of a patch on it.
    if(result.kind==='cylinder'&&f?.revolve&&coaxial(f.revolve,{axis:result.axis,center:result.origin},Math.max(f.revolve.radius*.15,q*50)))result={origin:f.revolve.center,axis:f.revolve.axis,radius:f.revolve.radius,kind:'part',fitError:1-f.revolve.roundness};
    return {...result,leaf,name:nameOf(ctx,leaf)};
  }
  // ---------------------------------------------------------------- how far a link swings before it touches the floor
  // Turning `leaves` about the axis through origin (positive = the right-hand way about axis), the first angle at which
  // their lowest point reaches the floor (or `limit` degrees). up: robot up as a CAD direction; floor: its height there.
  function swingToFloor(ctx,leaves,origin,axis,{up,floor,clearance=0,limit=150,sign=1}){
    const pts=[];for(const k of leaves){const v=ctx.vertsOf(k),step=Math.max(1,Math.floor(v.length/1500));for(let i=0;i<v.length;i+=step)pts.push(ctx.P(v[i]));}if(!pts.length)return null;
    const K=M(),low=deg=>{const R=K.math.about(origin,axis,sign*deg);let m=Infinity;for(const p of pts){const h=dot(K.math.apply(R,p),up);if(h<m)m=h;}return m-floor-clearance;};
    if(low(0)<=0)return 0;let prev=0;for(let a=1;a<=limit;a++){if(low(a)<=0){let lo=prev,hi=a;for(let i=0;i<20;i++){const mid=(lo+hi)/2;if(low(mid)<=0)hi=mid;else lo=mid;}return +hi.toFixed(2);}prev=a;}
    return null;
  }
  // ---------------------------------------------------------------- what moves on a robot
  const WORDS={
    flywheel:/fly ?wheel|rhino|stealth|compliant|shooter wheel|launcher wheel|\bwheel\b/i,
    roller:/gecko|compliant|roller|\bwheel\b|star|flex|squish|surgical|intake wheel|mecanum|omni/i,
    hood:/\bhood/i,turntable:/turn ?table|lazy ?susan|slew|ring gear|turret|\bgear\b|bearing|\bring\b|\d{2,3} ?t(ooth)?\b/i,
    hinge:/servo ?hub|hub ?shaft|hinge|pivot|axle|spline|horn/i,hinged:/\barm\b|claw|grip|wrist|elbow|shoulder|pivot|flip|bucket|outtake|deposit|scoop|kicker|deploy|linkage|four ?bar|4 ?bar|jaw|finger|lid|door|flap/i,slide:/slide|\blift\b|elevator|viper|linear|extension|extend|telescop|cascade|carriage|\brail|mast/i,hub:/sonic hub|\bhub\b/i,shaft:/shaft|axle|standoff|spacer|bearing|bushing|collar/i,
    drive:/servo|motor/i,servo:/\bservo\b(?!\s*(hub|horn|gear|arm))|motor/i,gear:/gear|pinion|pulley|sprocket/i,arm:/\barm\b|ramp|bump|scoop|kicker|flap|deflector|plate|guard/i,
    wheel:/wheel|mecanum|omni|traction/i};
  // discover({rows, unit, meta, mechanisms, want}): proposals for the game's own mechanisms (each intake and shooter, with
  // the CAD assemblies it was set up from) and for the drive wheels. Each proposal is a kinematics joint plus `report`.
  // want: mechanisms the team added and has not placed yet ({id, kind, name}); the joint found for one says so in `for`.
  function discover(ctx,{rows,unit:unitIn=1,meta,mechanisms,debug,want:wantIn}={}){
    const want=(Array.isArray(wantIn)?wantIn:[]).filter(w=>w&&typeof w.id==='string'&&typeof w.kind==='string').slice(0,48);
    const [F,L,T]=rows||[[1,0,0],[0,1,0],[0,0,1]],up=unit3(T),inch=1/(unitIn||1),joints=[],report=[],claimed=new Set(),K=M();
    let floor=Infinity;for(let v=0;v<ctx.positions.length/3;v+=Math.max(1,Math.floor(ctx.positions.length/3/200000)))floor=Math.min(floor,dot(ctx.P(v),up));
    // A part by its name: the exact name first ("Turret <1>" and "Turret <2>" are two copies, two assemblies), then without
    // its instance number. Parts that hold other listed parts (an assembly the import split into the turrets inside it)
    // are not a mechanism themselves.
    const metaAll=Array.isArray(meta?.parts)?meta.parts:[],holds=p=>typeof p.key==='string'&&metaAll.some(q=>q!==p&&typeof q.key==='string'&&q.key.startsWith(p.key+'/'));
    const metaParts=metaAll.filter(p=>!holds(p)),byName=name=>{const exact=s=>String(s||'').trim().toLowerCase(),clean=s=>exact(s).replace(/\s*<\d+>$/,'');return metaAll.find(p=>exact(p.name)===exact(name))||metaAll.find(p=>clean(p.name)===clean(name));};
    const leavesOf=names=>{const out=new Set();for(const n of names||[]){const p=byName(n),node=p?.key&&ctx.parts.byKey.get(p.key);if(node)for(const k of ctx.parts.leavesUnder(node))out.add(k);}return out;};
    const feat=k=>feature(ctx,k),rev=k=>feat(k)?.revolve,boxCenter=f=>scale(add(f.lo,f.hi),.5),teethOf=k=>teethOfName(nameOf(ctx,k));
    const horiz=v=>{const h=sub(v,scale(up,dot(v,up)));return len(h)>1e-9?unit(h):null;};
    const add_=j=>{joints.push(j);return j;},refs=set=>ctx.parts.compress(set);
    const coaxGroup=(seed,pool,tol)=>{const s=rev(seed),out=new Set([seed]);for(const k of pool){const r=rev(k);if(r&&coaxial(s,r,tol))out.add(k);}return out;};
    // Wheels that are not round (a star or flex wheel, its spokes repeating round the axle): centred on the axle of a
    // group of round parts, within its length, the same shape every way across it, reaching out from it, and filling
    // well under the circle it reaches (spokes: a flex wheel fills about 40%; a square block on the shaft, 64%, stays).
    // They turn with that axle. reach: how far a part's points reach from the axle.
    const reachFrom=(k,c,a)=>{const v=ctx.vertsOf(k),step=Math.max(1,Math.floor(v.length/800));let m=0;for(let i=0;i<v.length;i+=step)m=Math.max(m,lineDistance(ctx.P(v[i]),c,a));return m;};
    const seenAlong=(k,a)=>{let A=0;for(const t of ctx.trisOf(k)){const [i,j,l]=ctx.index3(t),p=ctx.P(i);A+=Math.abs(dot(cross(sub(ctx.P(j),p),sub(ctx.P(l),p)),a))/4;}return A;};
    function wheelsOn(g,pool){
      const r=[...g].map(rev).find(Boolean);if(!r)return [];const a=unit(r.axis),c=r.center;let lo=Infinity,hi=-Infinity;
      for(const k of g){const f=feat(k);for(const x of [f.lo[0],f.hi[0]])for(const y of [f.lo[1],f.hi[1]])for(const z of [f.lo[2],f.hi[2]]){const d=dot(sub([x,y,z],c),a);lo=Math.min(lo,d);hi=Math.max(hi,d);}}
      return pool.filter(k=>{if(g.has(k)||rev(k))return false;const f=feat(k);if(!f||lineDistance(f.center,c,a)>.03*inch)return false;const h=dot(sub(f.center,c),a);if(h<lo-.05*inch||h>hi+.05*inch)return false;
        const i=f.axes.reduce((b,v,j)=>Math.abs(dot(v,a))>Math.abs(dot(f.axes[b],a))?j:b,0),o=f.spread.filter((_,j)=>j!==i);if(Math.min(...o)<.9*Math.max(...o))return false;
        const reach=reachFrom(k,c,a);return reach>=.4*inch&&seenAlong(k,a)<.55*Math.PI*reach*reach;});}
    // A shaft carrying such wheels is a roller's or feeder's axle even when nothing on it is named as a wheel.
    const wheelAxles=(round,flat,groups)=>{for(const k of round){if(groups.some(g=>g.has(k))||!/shaft|axle/i.test(nameOf(ctx,k)))continue;const g=coaxGroup(k,round,Math.max(.06*inch,rev(k).radius*.08));if(wheelsOn(g,flat).length)groups.push(g);}};
    // Without the game's mechanisms (another field, or none set up), intakes and shooters come from the part names, and
    // what they would drive is moved by route actions instead (named positions).
    // Intake assemblies on one side (rollers, and the ramp or kicker beside them) are one intake.
    const fromNames=!mechanisms?.enabled,m=!fromNames?mechanisms:{intakes:(()=>{const by=new Map();for(const p of metaParts.filter(p=>p.role==='intake')){const side=sideOf(p),i=by.get(side);
        if(!i)by.set(side,{kind:p.kind==='kicker'?'kicker':'ramp',sides:[side],parts:[p.name]});else{if(i.parts.length<8)i.parts.push(p.name);if(p.kind!=='kicker')i.kind='ramp';}}return [...by.values()].slice(0,4);})(),
      // An "Outtake" on another field is usually a lift, arm and claw (found by their own names below), not a shooter.
      // Turrets with no flywheel assembly of their own are found by their names below (each one its own turret).
      shooters:(()=>{const turrets=metaParts.filter(p=>p.role==='shooter'&&p.type==='turret'&&/turret/i.test(p.name)&&!/shoot|launch|flywheel|pollen|nectar/i.test(p.name));
        const flys=metaParts.filter(p=>p.role==='shooter'&&!turrets.includes(p)&&!(/outtake/i.test(p.name)&&!/shoot|launch|fly ?wheel|turret|cannon|pollen|nectar/i.test(p.name)));
        if(!flys.length)return [];
        return flys.slice(0,2).map(p=>({type:p.type==='turret'||turrets.length?'turret':'fixed',parts:[p.name,...turrets.map(q=>q.name)]}));})()};
    // The side an intake assembly sticks out of (robot frame, from its box).
    function sideOf(p){if(!Array.isArray(p.box))return 'front';const c=scale(add(p.box.slice(0,3),p.box.slice(3)),.5),b=ctx.lo.map((v,i)=>(v+ctx.hi[i])/2),d=sub(c,b),x=dot(d,unit3(F)),y=dot(d,unit3(L));return Math.abs(x)>=Math.abs(y)?(x>=0?'front':'back'):(y>=0?'left':'right');}
    // ---- which CAD parts each game mechanism is
    // A shooter or intake set up without naming its CAD assemblies takes the ones the CAD names for it: by role and
    // pieces (the pollen shooter, the front intake), then by where it sits on the robot. A CAD with no named assemblies
    // has its flywheels looked for in the whole body: each shooter takes the assembly holding the one nearest its place,
    // and its turntable is looked for among every part under it.
    const turretOnly=name=>/turret/i.test(name)&&!/shoot|launch|flywheel|cannon|outtake|pollen|nectar/i.test(name);
    const clean=s=>String(s||'').replace(/\s*<\d+>$/,'').trim().toLowerCase(),bare=s=>String(s||'').replace(/\s*<\d+>$/,'').trim();
    // A CAD name as the page shows it: without its instance number, unless another part would read the same ("Turret <1>").
    const shown=name=>metaAll.some(p=>p.name!==name&&clean(p.name)===clean(name))?String(name):bare(name);
    const mid=scale(add(ctx.lo,ctx.hi),.5),half=d=>Math.abs(dot(sub(ctx.hi,ctx.lo),unit3(d)))/2||1;
    const placeOf=c=>[dot(sub(c,mid),unit3(F))/half(F),dot(sub(c,mid),unit3(L))/half(L)];
    const MOUNT=(root.DeckMechanisms||(typeof require==='function'?require('./sim-mechanisms.js'):null))?.MOUNT_AT||{},spotOf=s=>MOUNT[s.mount]||[0,0];
    const boxMid=p=>Array.isArray(p.box)&&p.box.length===6?scale(add(p.box.slice(0,3),p.box.slice(3)),.5):null;
    const plans=m.shooters.map(s=>({names:s.parts?.length?s.parts:null})),taken=new Set(m.shooters.flatMap(s=>s.parts||[]).map(clean));
    const shooterAsm=metaParts.filter(p=>p.role==='shooter'&&!turretOnly(p.name)),turretAsm=metaParts.filter(p=>p.role==='shooter'&&turretOnly(p.name));
    let flywheelsFound=null;const flyTaken=new Set();
    m.shooters.forEach((s,n)=>{if(plans[n].names||fromNames)return;const [fx,fy]=spotOf(s);
      const far=c=>{if(!c)return 2;const [x,y]=placeOf(c);return Math.hypot(x-fx,y-fy);},pieces=p=>!p.pieces||!s.pieces||p.pieces==='both'||s.pieces==='both'?1:p.pieces===s.pieces?0:3;
      const best=shooterAsm.filter(p=>!taken.has(clean(p.name))).map(p=>({p,score:pieces(p)+.5*far(boxMid(p))})).sort((a,b)=>a.score-b.score)[0]?.p;
      if(best){taken.add(clean(best.name));plans[n].names=[best.name,...(s.type==='turret'?turretAsm.map(p=>p.name):[])];
        report.push(`Shooter ${n+1}: your setup does not say which CAD parts it is, so it was linked to “${bare(best.name)}”${s.type==='turret'&&turretAsm.length?` on “${turretAsm.map(p=>bare(p.name)).join('”, “')}”`:''} by ${pieces(best)===0?'the pieces it shoots':'where it sits'}.`);return;}
      const key=c=>far(c.r.center)-.15*c.score,fly=(flywheelsFound||=flywheelsInCad()).filter(c=>!flyTaken.has(c.k)).sort((a,b)=>key(a)-key(b))[0];
      if(fly){flyTaken.add(fly.k);plans[n].own=assemblyAround(fly.k);plans[n].pool=s.type==='turret'?new Set(Array.from({length:ctx.leaves},(_,k)=>k)):null;plans[n].found=true;
        report.push(`Shooter ${n+1}: no CAD part is named for it, so its flywheel was looked for in the whole CAD: “${nameOf(ctx,fly.k)}”.`);}});
    // Round parts with a level axle in the upper part of the robot, the biggest on each axle (drive wheels are left out).
    function flywheelsInCad(){
      const top=dot(ctx.hi,up),out=[];for(let k=0;k<ctx.leaves;k++){const r=rev(k);if(!r||Math.abs(dot(r.axis,up))>.3)continue;const rad=r.radius*inch,name=nameOf(ctx,k);
        if(rad<.7||rad>3.5||/mecanum|omni|traction|drive/i.test(name)||dot(r.center,up)-floor<(top-floor)*.45)continue;out.push({k,r,score:rad+(WORDS.flywheel.test(name)?2:0)});}
      out.sort((a,b)=>b.score-a.score);const kept=[];for(const c of out)if(!kept.some(o=>coaxial(o.r,c.r,Math.max(.1*inch,o.r.radius*.1))))kept.push(c);return kept;}
    // The parts that go with a part: the largest assembly holding it that is not a big share of the robot, or, in a CAD
    // without assemblies, the parts round it.
    function assemblyAround(k){
      const nodes=ctx.parts.nodes;let at=ctx.tree?.leaf?.[k],best=null;
      while(at>=0&&nodes[at]){const all=ctx.parts.leavesUnder(nodes[at]);if(all.length>ctx.leaves*.35)break;if(all.length>=3)best=all;at=nodes[at].parent;}
      if(best)return new Set(best);const r=rev(k),reach=(r?r.radius*2.5:0)+1.5*inch,c=r?r.center:boxCenter(feat(k)),out=new Set([k]);
      for(let q=0;q<ctx.leaves;q++){const f=feat(q);if(f&&len(sub(boxCenter(f),c))<=reach)out.add(q);}return out;}
    // Intakes: the intake assemblies on its sides.
    const intakeAsm=metaParts.filter(p=>p.role==='intake'),intakeTaken=new Set(m.intakes.flatMap(i=>i.parts||[]).map(clean));
    const intakeNames=m.intakes.map((intake,n)=>{if(intake.parts?.length||fromNames)return intake.parts||null;
      const on=intakeAsm.filter(p=>!intakeTaken.has(clean(p.name))&&(intake.sides||['front']).includes(sideOf(p)));if(!on.length)return null;for(const p of on)intakeTaken.add(clean(p.name));
      report.push(`Intake ${n+1}: your setup does not say which CAD parts it is, so it was linked to “${on.map(p=>bare(p.name)).join('”, “')}” on its side.`);return on.map(p=>p.name);});
    // Not found: a moving part with no CAD parts yet, listed so the team can choose its parts and pivot. Nothing is drawn.
    const unlinked=(j,what)=>add_({...j,parts:[],source:'standin',confidence:0,note:`${what} was not found in your CAD.`});
    // ---- shooters
    const shared=new Map();plans.forEach(p=>(p.names||[]).forEach(n=>shared.set(n,(shared.get(n)||0)+1)));
    m.shooters.forEach((s,n)=>{
      // A turret assembly that is all the shooter is in the CAD ("Turret <1>" holding its flywheel and hood) carries its own
      // shooter: its flywheel and hood are looked for in it too.
      const plan=plans[n],own=new Set(plan.own||[]),turretPool=new Set(plan.pool||[]),names=plan.names||[],carried=names.length>0&&names.every(x=>turretOnly(x)&&!(shared.get(x)>1));
      for(const name of names){const set=leavesOf([name]);for(const k of set)(!carried&&(turretOnly(name)||shared.get(name)>1)?turretPool:own).add(k);}
      const label=`Shooter ${n+1}`,lone=s.type==='turret'&&!s.sharesTurret&&!fromNames,asm=names.length?names.map(x=>`“${shown(x)}”`).join(' + '):'';
      if(!own.size&&!turretPool.size){report.push(`${label}: no CAD parts were found for it${lone?'; its turret is listed under Moving parts with no parts yet':''}.`);
        if(lone){const [fx,fy]=spotOf(s),c=add(add(mid,scale(unit3(F),fx*half(F)*.6)),scale(unit3(L),fy*half(L)*.6));
          unlinked({id:`turret${n+1}`,name:`Turret · ${label.toLowerCase()}`,type:'continuous',origin:add(c,scale(up,dot(ctx.hi,up)-dot(c,up))),axis:up,zero:0,drive:{signal:'turret',of:'shooter:'+n}},`${label}’s turret`);}
        return;}
      const ownList=[...own].filter(k=>feat(k));
      // Flywheel: the biggest round part in the shooter whose axis lies flat, named like a wheel when one is.
      const wheels=ownList.filter(k=>{const r=rev(k);return r&&r.radius*inch>=.5&&Math.abs(dot(r.axis,up))<.5;}).sort((a,b)=>score(b)-score(a));
      function score(k){const r=rev(k);return r.radius*inch+(WORDS.flywheel.test(nameOf(ctx,k))?2:0)+(r.length<r.radius*1.6?.3:0);}
      let fly=null;const flyKey=wheels[0];
      if(flyKey!==undefined){const r=rev(flyKey),group=coaxGroup(flyKey,ownList,Math.max(.06*inch,r.radius*.06));
        fly={key:flyKey,r,group};report.push(`${label}: flywheel “${nameOf(ctx,flyKey)}” (${(2*r.radius*inch).toFixed(2)} in), ${group.size} parts on its axle.`);}
      // Hood: parts named hood; it pivots about the flywheel axle when its arc is concentric with it, else about the round
      // part at its end that lines up with the flywheel's axis direction.
      const hoodSeed=ownList.filter(k=>WORDS.hood.test(nameOf(ctx,k)));let hood=null;
      if(hoodSeed.length){
        const hb=boxOf(hoodSeed.map(feat)),grow=.15*inch,size=len(sub(hb.hi,hb.lo));
        const drives=ownList.filter(k=>WORDS.drive.test(nameOf(ctx,k))),driveAxles=drives.map(rev).filter(Boolean);
        const set=new Set(hoodSeed);for(const k of ownList){if(set.has(k)||fly?.group.has(k))continue;const f=feat(k),c=boxCenter(f);
          if(len(sub(f.hi,f.lo))>size*1.3)continue;if(![0,1,2].every(i=>c[i]>=hb.lo[i]-grow&&c[i]<=hb.hi[i]+grow))continue;
          // A gear on a servo or motor drives the hood but stays with the frame.
          const r=rev(k);if(r&&driveAxles.some(d=>coaxial(d,r,.15*inch)))continue;set.add(k);}
        // Hardware on the hood's own shafts (spacers, bearings and collars past its plates) goes with it.
        if(fly){const a=unit(fly.r.axis);for(const s of [...set].filter(k=>/shaft|axle/i.test(nameOf(ctx,k)))){const f=feat(s),c=boxCenter(f),span=[dot(f.lo,a),dot(f.hi,a)].sort((x,y)=>x-y);
          for(const k of ownList){if(set.has(k)||fly.group.has(k)||!WORDS.shaft.test(nameOf(ctx,k)))continue;const kc=boxCenter(feat(k)),h=dot(kc,a);if(lineDistance(kc,c,a)<.08*inch&&h>=span[0]-.1*inch&&h<=span[1]+.1*inch)set.add(k);}}}
        let pivot=null,why='',confidence=.35;
        if(fly){// Points of the hood's parts, seen along the flywheel axis: is their outline an arc about the axle?
          const a=fly.r.axis,u=perpendicular(a),w=cross(a,u),pts=[];for(const k of hoodSeed){const v=ctx.vertsOf(k),step=Math.max(1,Math.floor(v.length/1500));for(let i=0;i<v.length;i+=step){const p=ctx.P(v[i]);pts.push({x:dot(p,u),y:dot(p,w)});}}
          const fc={x:dot(fly.r.center,u),y:dot(fly.r.center,w)},arc=ransacCircle(pts,.04*inch,{minR:fly.r.radius*1.2,maxR:fly.r.radius*6});
          if(arc&&arc.share>.12&&Math.hypot(arc.x-fc.x,arc.y-fc.y)<Math.max(.35*inch,arc.r*.12)){pivot={origin:fly.r.center,axis:a};why=`its arc (${(arc.r*inch).toFixed(1)} in) is centred on the flywheel axle`;confidence=.8;}
          else{const candidates=ownList.filter(k=>{const r=rev(k);return r&&!fly.group.has(k)&&parallel(r.axis,a)&&set.has(k)&&WORDS.shaft.test(nameOf(ctx,k));});
            const bottom=candidates.sort((x,y)=>dot(rev(x).center,up)-dot(rev(y).center,up))[0];
            if(bottom!==undefined){pivot={origin:rev(bottom).center,axis:a};why=`it turns on “${nameOf(ctx,bottom)}”`;confidence=.45;}
            else{pivot={origin:fly.r.center,axis:a};why='no hinge found on it; it is set to turn about the flywheel axle';confidence=.3;}}}
        if(pivot){hood={set,pivot,why,confidence};for(const k of set)claimed.add(k);}
      }
      // Turret: a large round part with an upright axis (a turntable gear or bearing) under this shooter.
      let turret=null;
      if(s.type==='turret'&&!s.sharesTurret){
        const ownCenter=own.size?centroidOf([...own].map(feat).filter(Boolean)):null;
        // Looking through the whole CAD, only a turntable under the shooter, with the shooter over it, will do.
        const under=k=>{const r=rev(k);return !plan.found||!ownCenter||dot(r.center,up)<=dot(ownCenter,up)&&lineDistance(ownCenter,r.center,unit3(r.axis))<=r.radius+1.5*inch;};
        const pool=[...new Set([...turretPool,...ownList])].filter(k=>{const r=rev(k);return r&&parallel(r.axis,up,6)&&r.radius*inch>=1.1&&under(k);});
        const rank=k=>{const r=rev(k),d=ownCenter?lineDistance(ownCenter,r.center,unit3(r.axis))*inch:0;return r.radius*inch*.6+(WORDS.turntable.test(nameOf(ctx,k))?1.5:0)+(turretPool.has(k)?.5:0)-d*1.2+r.roundness;};
        pool.sort((a,b)=>rank(b)-rank(a));const pick=pool[0];
        if(pick!==undefined){const r=rev(pick),axis=dot(r.axis,up)>=0?r.axis:scale(r.axis,-1);
          // What sits wholly under the turntable (the plate it is bolted to) stays with the robot.
          const above=f=>Math.max(dot(f.hi,up),dot(f.lo,up))>=dot(r.center,up)-r.length,set=new Set([...own].filter(k=>!feat(k)||above(feat(k))));
          for(const k of turretPool){const f=feat(k);if(!f)continue;const c=boxCenter(f);if(lineDistance(c,r.center,axis)<=r.radius*.85&&above(f))set.add(k);}
          set.add(pick);turret={set,ring:nameOf(ctx,pick),origin:r.center,axis,why:`it turns on “${nameOf(ctx,pick)}” (${(2*r.radius*inch).toFixed(1)} in across)`,confidence:WORDS.turntable.test(nameOf(ctx,pick))?.85:.6};}
        else if(own.size){const f=boxOf([...own].map(feat).filter(Boolean)),c=boxCenter(f);turret={set:new Set([...own]),origin:c,axis:up,why:'no round turntable part was found; it turns about the middle of the shooter',confidence:.3};}
      }
      // Which way it fires in the CAD: across the flywheel, from the hood over the wheel, at right angles to the axle.
      let zero=0,aimWhy='which way it fires in your CAD is not known; check the arrow';
      if(fly&&hood){const d=horiz(sub(fly.r.center,centroidOf([...hood.set].map(feat).filter(Boolean)))),across=d&&horiz(sub(d,scale(fly.r.axis,dot(d,fly.r.axis))));
        if(across){zero=Math.atan2(dot(across,unit3(L)),dot(across,unit3(F)))*180/Math.PI;aimWhy='it fires over the flywheel, away from the hood';}}
      const tid=`turret${n+1}`;
      if(turret){add_({id:tid,name:`Turret · ${label.toLowerCase()}`,type:'continuous',parts:refs(turret.set),origin:turret.origin,axis:turret.axis,zero:+zero.toFixed(1),drive:{signal:'turret',of:'shooter:'+n},source:'inferred',confidence:turret.confidence,radius:rev([...turret.set].find(k=>rev(k)&&coaxial(rev(k),{axis:turret.axis,center:turret.origin},.1*inch)))?.radius,
        note:`${asm?`${asm} turns`:'Turns'} about this axis because ${turret.why}. Faces ${Math.round(zero)}° in the CAD because ${aimWhy}.`});for(const k of turret.set)claimed.add(k);}
      else if(lone)unlinked({id:tid,name:`Turret · ${label.toLowerCase()}`,type:'continuous',origin:own.size?boxCenter(boxOf([...own].map(feat).filter(Boolean))):mid,axis:up,zero:+zero.toFixed(1),drive:{signal:'turret',of:'shooter:'+n}},`${label}’s turntable`);
      // The flywheel spins so the side facing the hood (or the robot's middle) moves up, carrying the piece.
      const spin=fly&&(()=>{const toward=hood?sub(centroidOf([...hood.set].map(feat).filter(Boolean)),fly.r.center):scale(up,-1),side=unit(sub(toward,scale(fly.r.axis,dot(toward,fly.r.axis))));return dot(cross(fly.r.axis,side),up)>=0?fly.r.axis:scale(fly.r.axis,-1);})();
      if(fly){add_({id:`flywheel${n+1}`,name:`Flywheel · ${label.toLowerCase()}`,type:'continuous',parent:turret?tid:null,parts:refs(fly.group),origin:fly.r.center,axis:spin,radius:fly.r.radius,drive:{signal:'flywheel',of:'shooter:'+n},source:'inferred',confidence:WORDS.flywheel.test(nameOf(ctx,fly.key))?.85:.6,
          note:`“${nameOf(ctx,fly.key)}” is the largest round part with a level axle in ${asm||'this shooter'}. It is drawn turning slower than it really spins.`});for(const k of fly.group)claimed.add(k);}
      // Where the shot leaves in the CAD: the end of the hood the spin carries the piece to, along the hood's curve there.
      // Tilting the hood about the axle turns that angle as much, so it tilts to the launch angle the game shoots at;
      // its axis is set so a positive tilt raises the shot.
      const launch=fly&&hood&&hood.confidence>=.8?launchOf(hoodSeed,fly.r.center,spin):null;
      if(hood)add_({id:`hood${n+1}`,name:`Hood · ${label.toLowerCase()}`,type:'revolute',parent:turret?tid:null,parts:refs(hood.set),origin:hood.pivot.origin,axis:launch?launch.axis:hood.pivot.axis,states:{rest:0,shoot:0},...(launch?{launch:+launch.deg.toFixed(1)}:{}),speed:120,drive:{signal:'hood',of:'shooter:'+n},source:'inferred',confidence:hood.confidence,
        note:`“${nameOf(ctx,hoodSeed[0])}”${asm?` in ${asm}`:''} pivots here because ${hood.why}. ${launch?`In your CAD a shot leaves at ${launch.deg.toFixed(0)}° above level, so it tilts to the launch angle while the shooter spins up and aims.`:'Set how far it tilts to shoot.'}`});
      // What this shooter is in the CAD, in a line the page shows after Find again.
      if(asm&&(turret||fly||hood)){const bits=[...(turret?[turret.ring?`a turret on “${turret.ring}”`:'a turret with no turntable found']:[]),fly?`flywheel “${nameOf(ctx,fly.key)}”`:'no flywheel found in it',...(hood?[`hood “${nameOf(ctx,hoodSeed[0])}”`]:[])];
        report.push(`${label} is ${asm} in your CAD: ${bits.join(', ')}.`);}
    });
    function launchOf(seed,c,a){
      const u=perpendicular(a),w=cross(a,u),ang=[];for(const k of seed){const v=ctx.vertsOf(k),step=Math.max(1,Math.floor(v.length/800));for(let i=0;i<v.length;i+=step){const d=sub(ctx.P(v[i]),c);ang.push(Math.atan2(dot(d,w),dot(d,u)));}}
      if(ang.length<8)return null;ang.sort((x,y)=>x-y);
      // The hood covers the circle but for its widest gap; going the way it spins, the hood ends where that gap begins.
      let gap=ang[0]+2*Math.PI-ang.at(-1),end=ang.at(-1);for(let i=1;i<ang.length;i++)if(ang[i]-ang[i-1]>gap){gap=ang[i]-ang[i-1];end=ang[i-1];}
      if(gap<Math.PI/3)return null;const r=add(scale(u,Math.cos(end)),scale(w,Math.sin(end))),deg=Math.asin(clamp(dot(cross(a,r),up),-1,1))*180/Math.PI;
      return deg>5&&deg<89?{deg,axis:dot(r,up)>0?scale(a,-1):a}:null;}
    // ---- intakes
    // An intake set up as a sweeper (or side rollers) whose CAD has a plate or arm swinging down on a servo is really a
    // ramp (rollers behind it) or a kicker (no rollers): `kinds` says so, and the page sets the intake to it.
    const kinds=[],flats=new Map(),fix1=v=>+(+v).toFixed(1);
    m.intakes.forEach((intake,n)=>{
      const label=`Intake ${n+1}`,side=(intake.sides||['front'])[0],out=unit3({front:F,back:scale(F,-1),left:L,right:scale(L,-1)}[side]||F),edge=unit(cross(up,out));
      const deploys=intake.kind==='ramp'||intake.kind==='kicker',swings=deploys&&!fromNames,did=`deploy${n+1}`,kindName=intake.kind==='kicker'?'Kicker':'Ramp';
      const missing=()=>{if(swings)unlinked({id:did,name:`${kindName} · ${label.toLowerCase()}`,type:'revolute',origin:add(add(mid,scale(out,half(out)*.85)),scale(up,floor+(dot(ctx.hi,up)-floor)*.35-dot(mid,up))),axis:edge,states:{raised:0,lowered:80},drive:{signal:'deploy',of:'intake:'+n}},`${label}’s ${kindName.toLowerCase()}`);};
      // With no assembly named for it, a ramp or kicker is looked for among the parts on its side of the robot.
      let own=[...leavesOf(intakeNames[n])].filter(k=>!claimed.has(k)&&feat(k));const guessed=!own.length&&swings;
      if(guessed)for(let k=0;k<ctx.leaves;k++){const f=feat(k);if(f&&!claimed.has(k)&&dot(sub(boxCenter(f),mid),out)>=.3*half(out))own.push(k);}
      if(!own.length){report.push(`${label}: no CAD parts were found for it${swings?`; its ${kindName.toLowerCase()} is listed under Moving parts with no parts yet`:''}.`);missing();return;}
      // Rollers: groups of round parts on one axle with a roller or wheel among them.
      const round=own.filter(k=>rev(k));const groups=[];
      for(const k of round.filter(k=>WORDS.roller.test(nameOf(ctx,k))&&rev(k).radius*inch>=.3)){if(groups.some(g=>g.has(k)))continue;groups.push(coaxGroup(k,round,Math.max(.06*inch,rev(k).radius*.08)));}
      if(!guessed)wheelAxles(round,own.filter(k=>!rev(k)),groups);
      // Pivot: hinge hardware (a servo hub, hub shaft, axle...) lined up along the intake's edge, above its rollers. Every
      // intake's own assemblies are looked through, whatever it is set up as: the CAD shows whether something swings.
      let deploy=null;
      {
        const lines=[];for(const k of round){const r=rev(k);if(!parallel(r.axis,edge,10))continue;let line=lines.find(l=>coaxial(l.r,r,.12*inch));if(!line)lines.push(line={r,members:[]});line.members.push(k);}
        // A hinge line: hinge hardware on it, a servo whose output sits on it, an arm or ramp it passes through. Pulleys,
        // gears and rollers on a line mark an axle that drives something instead; plain spacers and bearings say little.
        const servos=own.filter(k=>WORDS.servo.test(nameOf(ctx,k))),arms=own.filter(k=>WORDS.arm.test(nameOf(ctx,k))&&!rev(k));
        const through=(l,k,pad)=>{const f=feat(k),a=l.r.axis,u=perpendicular(a),w=cross(a,u);let ulo=Infinity,uhi=-Infinity,wlo=Infinity,whi=-Infinity;
          for(const x of [f.lo[0],f.hi[0]])for(const y of [f.lo[1],f.hi[1]])for(const z of [f.lo[2],f.hi[2]]){const p=sub([x,y,z],l.r.center),s=dot(p,u),t=dot(p,w);ulo=Math.min(ulo,s);uhi=Math.max(uhi,s);wlo=Math.min(wlo,t);whi=Math.max(whi,t);}
          return ulo<=pad&&uhi>=-pad&&wlo<=pad&&whi>=-pad;};
        for(const l of lines){const names=l.members.map(k=>nameOf(ctx,k));let plain=0;
          l.score=names.reduce((s,x)=>{if(WORDS.hinge.test(x))return s+4;if(WORDS.hub.test(x))return s+1.5;if(WORDS.roller.test(x))return s-2.5;if(WORDS.gear.test(x))return s-1.5;if(WORDS.shaft.test(x))plain++;return s;},0)+Math.min(1,plain*.2);
          if(servos.some(k=>through(l,k,.3*inch)))l.score+=3;if(arms.some(k=>through(l,k,.05*inch)))l.score+=2;}
        lines.sort((a,b)=>b.score-a.score);const best=lines[0];debug?.push({intake:n,lines:lines.map(l=>({score:+l.score.toFixed(2),center:l.r.center.map(v=>+v.toFixed(2)),names:l.members.map(k=>nameOf(ctx,k))}))});
        // An intake not set up to swing needs a hinge the CAD makes plain: hinge hardware or a servo on the line.
        if(best&&best.score>(guessed?2.5:deploys?0:3)){const origin=best.r.center;let axis=best.r.axis;
          // What swings: parts beyond the hinge (away from the robot) that are not held by parts reaching back across it.
          const ext=k=>{const f=feat(k);let lo=Infinity,hi=-Infinity;for(const x of [f.lo[0],f.hi[0]])for(const y of [f.lo[1],f.hi[1]])for(const z of [f.lo[2],f.hi[2]]){const d=dot(sub([x,y,z],origin),out);if(d<lo)lo=d;if(d>hi)hi=d;}return [lo,hi];};
          // Hinge hardware: the round parts on the line, and any small part the line passes straight through (a hub
          // with flats, a clamp, a horn).
          const hinge=new Set(best.members),margin=.4*inch,beyond=new Set(),fixed=new Set(),u=perpendicular(axis),w=cross(axis,u);
          for(const k of own){if(hinge.has(k))continue;const f=feat(k);let ulo=Infinity,uhi=-Infinity,wlo=Infinity,whi=-Infinity;
            for(const x of [f.lo[0],f.hi[0]])for(const y of [f.lo[1],f.hi[1]])for(const z of [f.lo[2],f.hi[2]]){const p=sub([x,y,z],origin),a=dot(p,u),b=dot(p,w);ulo=Math.min(ulo,a);uhi=Math.max(uhi,a);wlo=Math.min(wlo,b);whi=Math.max(whi,b);}
            if(ulo<=0&&uhi>=0&&wlo<=0&&whi>=0&&Math.max(uhi-ulo,whi-wlo)<1.6*inch)hinge.add(k);}
          // Beyond the hinge, or an arm on it: the hinge line runs through it and it reaches much further out than back
          // (an arm wraps a little way round its own pivot hole). A plate holding the hinge reaches back as far or further.
          const onLine=k=>{const f=feat(k);let ulo=Infinity,uhi=-Infinity,wlo=Infinity,whi=-Infinity;for(const x of [f.lo[0],f.hi[0]])for(const y of [f.lo[1],f.hi[1]])for(const z of [f.lo[2],f.hi[2]]){const p=sub([x,y,z],origin),a=dot(p,u),b=dot(p,w);ulo=Math.min(ulo,a);uhi=Math.max(uhi,a);wlo=Math.min(wlo,b);whi=Math.max(whi,b);}return ulo<=0&&uhi>=0&&wlo<=0&&whi>=0;};
          for(const k of own){if(hinge.has(k))continue;const [lo,hi]=ext(k);if(lo>=-margin||onLine(k)&&hi>=2*-lo&&hi>inch)beyond.add(k);else fixed.add(k);}
          const touching=(a,b)=>{const f=feat(a),g=feat(b),t=.02*inch;return [0,1,2].every(i=>f.lo[i]<=g.hi[i]+t&&g.lo[i]<=f.hi[i]+t);};
          // Clusters of touching parts beyond the hinge; one that touches the fixed frame is fixed too.
          const seen=new Set(),moving=new Set();for(const k of beyond){if(seen.has(k))continue;const cluster=[],q=[k];seen.add(k);
            while(q.length){const x=q.pop();cluster.push(x);for(const y of beyond)if(!seen.has(y)&&touching(x,y)){seen.add(y);q.push(y);}}
            const held=cluster.some(x=>[...fixed].some(y=>touching(x,y)));if(!held)for(const x of cluster)moving.add(x);}
          for(const k of hinge)moving.add(k);
          debug?.push({hinge:[...hinge].map(k=>nameOf(ctx,k)),beyond:[...beyond].map(k=>nameOf(ctx,k)),moving:[...moving].map(k=>nameOf(ctx,k))});if(moving.size>hinge.size){
            // Positive turns lower it: the swinging parts' centre goes down.
            const c=centroidOf([...moving].map(feat)),turned=K.math.apply(K.math.about(origin,axis,10),c);if(dot(turned,up)>dot(c,up))axis=scale(axis,-1);
            const lowered=swingToFloor(ctx,[...moving],origin,axis,{up,floor,clearance:.02*inch});
            deploy={moving,origin,axis,lowered,why:`it hinges on ${[...new Set(best.members.map(k=>nameOf(ctx,k)).sort((x,y)=>WORDS.hinge.test(y)-WORDS.hinge.test(x)).map(x=>`“${x}”`))].slice(0,3).join(', ')}`,confidence:guessed?.45:best.score>=3?.75:.5};}}
        if(!deploy&&deploys){report.push(`${label}: no hinge was found ${guessed?'on its side of the robot':`in “${(intakeNames[n]||[]).map(bare).join(', ')}”`}, so it is listed under Moving parts with no parts yet: choose its parts, then pick the hinge.`);missing();}
      }
      // What the CAD says it is: rollers that pull pieces in make a swinging plate a ramp; with none it is a kicker.
      const kind=deploys?intake.kind:groups.length?'ramp':'kicker',named=kind==='kicker'?'Kicker':'Ramp';
      // The biggest plates that swing, by name, to say what was found.
      const swung=deploy?[...new Set([...deploy.moving].filter(k=>!rev(k)).sort((x,y)=>feat(y).area-feat(x).area).map(k=>`“${nameOf(ctx,k)}”`))].slice(0,2).join(' and '):'';
      if(deploy){add_({id:did,name:`${named} · ${label.toLowerCase()}`,type:'revolute',parts:refs(deploy.moving),origin:deploy.origin,axis:deploy.axis,states:{raised:0,lowered:deploy.lowered??60},drive:{signal:'deploy',of:'intake:'+n},source:'inferred',confidence:deploy.confidence,
        note:`Swings here because ${deploy.why}. ${deploy.lowered!==null?`Down is where it touches the floor (${deploy.lowered}°).`:'It did not reach the floor within 150°; set how far it goes down.'} Up is how it sits in the CAD.`});for(const k of deploy.moving)claimed.add(k);
        if(!deploys){kinds.push({intake:n,kind,joint:did,why:`${swung||'its plate'} swing${swung.includes(' and ')?'':'s'} down on ${deploy.why.replace(/^it hinges on /,'')}${kind==='ramp'?' in front of its rollers':''}`});
          report.push(`${label}: ${swung||'a plate'} swing${swung.includes(' and ')?'':'s'} down on a hinge in your CAD, so it is a ${kind==='ramp'?'deployable ramp':'kicker'}.`);}}
      // Rollers are taken only from parts named for the intake (guessing from its side would find the drive wheels).
      const rolled=[];if(!guessed)groups.forEach((g,i)=>{if([...g].some(k=>claimed.has(k)&&!deploy?.moving.has(k)))return;const seed=[...g].sort((a,b)=>rev(b).radius-rev(a).radius)[0],r=rev(seed);
        // A roller on a swing arm (not on the ramp): the arm is its own moving part and the roller turns on it.
        const onRamp=deploy&&[...g].some(k=>deploy.moving.has(k)),arm=onRamp?null:rollerArm(g,own),aid=arm&&uniqueId(`arm${n+1}`);
        if(arm){const sl=arm.slot?`the ${arm.slot.kind} in “${nameOf(ctx,arm.slot.k)}”`:'the frame';
          add_({id:aid,name:`Roller arm${groups.length>1?' '+(i+1):''} · ${label.toLowerCase()}`,type:'revolute',parts:refs(arm.moving),origin:arm.origin,axis:arm.axis,lower:arm.lower,upper:arm.upper,home:[arm.lower],states:{rest:arm.lower,up:arm.upper},gaps:arm.gaps,speed:360,drive:{signal:'float',of:'intake:'+n},source:'inferred',confidence:arm.confidence,
            note:`Its plates (${arm.plates.map(k=>`“${nameOf(ctx,k)}”`).filter((x,j,a)=>a.indexOf(x)===j).join(', ')}) hold the roller and turn on ${arm.why}; ${sl} lets the roller’s axle travel ${arm.lower<-.5?`${fix1(-arm.lower)}° down and `:''}${fix1(arm.upper)}° up from where your CAD has it. Nothing drives it: it rests at the bottom (${arm.gaps.rest} in under the roller) and a bigger piece lifts it, up to ${arm.gaps.up} in.`});
          for(const k of arm.moving)if(!g.has(k))claimed.add(k);report.push(`${label}: its roller rides on a swing arm in ${sl}: ${arm.gaps.rest} in under it at rest, ${arm.gaps.up} in at the top of the slot.`);}
        // Star or flex wheels on its axle turn with it.
        const wheels=wheelsOn(g,own.filter(k=>!claimed.has(k)||arm?.moving.has(k))),turning=g.size;for(const k of wheels)g.add(k);
        // Rollers turn so their underside sweeps pieces in, toward the robot.
        const bottom=scale(up,-1),inward=scale(out,-1),axis=dot(cross(r.axis,bottom),inward)>=0?r.axis:scale(r.axis,-1);
        add_({id:`roller${n+1}${groups.length>1?String.fromCharCode(97+i):''}`,name:`Roller${groups.length>1?' '+(i+1):''} · ${label.toLowerCase()}`,type:'continuous',parent:onRamp?did:arm?aid:null,parts:refs(g),origin:r.center,axis,radius:Math.max(r.radius,...wheels.map(k=>reachFrom(k,r.center,unit(r.axis)))),drive:{signal:'roller',of:'intake:'+n},source:'inferred',confidence:.75,
          note:`${turning} round parts on one axle with “${nameOf(ctx,seed)}”${wheels.length?`, and ${wheels.length} star or flex wheel${wheels.length>1?'s':''} (“${nameOf(ctx,wheels[0])}”) centred on it`:''}.`});for(const k of g)claimed.add(k);rolled.push(nameOf(ctx,seed));});
      // What this intake is in the CAD, in a line the page shows after Find again.
      const inCad=(intakeNames[n]||[]).map(x=>`“${shown(x)}”`).join(' + ');
      if(inCad&&!guessed&&(deploy||rolled.length))report.push(`${label} is ${inCad} in your CAD: ${[...(rolled.length?[`rollers “${[...new Set(rolled)].join('”, “')}”`]:[]),...(deploy?[`a ${named.toLowerCase()} that swings down on ${deploy.why.replace(/^it hinges on /,'')}`]:[])].join(', ')}.`);
    });
    // ---- a roller on a swing arm
    // Plates that hold the roller's axle snugly and turn on another axle (the drive axle, often) inside frame plates whose
    // slot or cutout lets the roller's axle, and what sits in them, travel round that axle. Seen along the axle, each
    // part is its triangles flattened; the roller's axle is swung round each candidate axle until it meets a frame
    // plate's edge, which gives how far the arm goes each way. Only one axle may join the arm plates to the frame (two
    // would hold it still), and a roller held snugly by every plate it passes through is on no arm.
    function rollerArm(g,own){
      const seed=[...g].sort((a,b)=>rev(b).radius-rev(a).radius)[0],r=rev(seed),a=unit(r.axis),u=perpendicular(a),w=cross(a,u),to2=p=>[dot(p,u),dot(p,w)],q=to2(r.center);
      const span=k=>{const f=feat(k);let lo=Infinity,hi=-Infinity;for(const x of [f.lo[0],f.hi[0]])for(const y of [f.lo[1],f.hi[1]])for(const z of [f.lo[2],f.hi[2]]){const d=dot([x,y,z],a);if(d<lo)lo=d;if(d>hi)hi=d;}return [lo,hi];};
      // Overlapping along the axle by a good share of the thinner part (touching faces do not count).
      const across=(x,y)=>Math.min(x[1],y[1])-Math.max(x[0],y[0])>.3*Math.min(x[1]-x[0],y[1]-y[0])+1e-9;
      const inBox=(o,p,pad=0)=>p[0]>=o.x0-pad&&p[0]<=o.x1+pad&&p[1]>=o.y0-pad&&p[1]<=o.y1+pad;
      const lines=[];for(const k of own){if(g.has(k)||claimed.has(k))continue;const s=rev(k);if(!s||!parallel(s.axis,a,10)||coaxial(r,s,.12*inch))continue;
        let l=lines.find(x=>coaxial(x.r,s,.12*inch));if(!l)lines.push(l={r:s,members:[]});l.members.push(k);}
      for(const l of lines){l.q=to2(l.r.center);l.d=Math.hypot(l.q[0]-q[0],l.q[1]-q[1]);l.spans=l.members.map(span);}
      const gs=[...g].map(k=>[k,span(k)]),plates=[];
      for(const k of own){if(g.has(k)||claimed.has(k)||rev(k))continue;const s=span(k);if(!gs.some(([,x])=>across(x,s)))continue;const o=flat(k,a,u,w);if(!inBox(o,q))continue;
        // The probe: what sits in this plate on the roller's axle (a bearing, the roller itself), a little smaller.
        let rad=0;for(const [m,x] of gs)if(across(x,s))rad=Math.max(rad,rev(m).radius);const pr=Math.max(.03*inch,rad*.85);
        if(near2(o,q[0],q[1],pr))continue;plates.push({k,o,s,pr});}
      debug?.push({arm:nameOf(ctx,seed),plates:plates.map(p=>`${nameOf(ctx,p.k)} #${p.k}`),lines:lines.map(l=>`${l.members.map(k=>nameOf(ctx,k)).slice(0,3).join('/')} d=${(l.d*inch).toFixed(2)}`)});
      if(plates.length<2)return null;
      // An axle passes through a plate where the plate has a hole and its parts reach into the plate's thickness.
      const pierces=(l,p)=>inBox(p.o,l.q)&&l.spans.some(x=>across(x,p.s))&&!near2(p.o,l.q[0],l.q[1],.03*inch);
      for(const l of lines.filter(l=>l.d>=1*inch&&l.d<=10*inch).sort((x,y)=>x.d-y.d)){
        // Positive turns raise the roller.
        let axis=a;const lifted=K.math.apply(K.math.about(l.r.center,a,10),r.center);if(dot(lifted,up)<dot(r.center,up))axis=scale(a,-1);const sgn=axis===a?1:-1;
        // Swung about this axle, a plate holding the roller snugly stops it at once (a bearing in its bore): on the
        // axle it is an arm plate, off it the roller cannot swing about this axle at all. One that lets it go is the
        // frame, and how far it lets it go is the arm's range.
        const swung=plates.map(p=>({...p,pu:swing(p.o,q,l.q,p.pr,sgn),pd:swing(p.o,q,l.q,p.pr,-sgn)})),snug=p=>p.pu+p.pd<4;
        const arms=swung.filter(snug),frames=swung.filter(p=>!snug(p));debug?.push({pivot:l.members.map(k=>nameOf(ctx,k)).slice(0,3).join('/'),swung:swung.map(p=>`${nameOf(ctx,p.k)} #${p.k} ${p.pd}/${p.pu}${pierces(l,p)?' on it':''}`)});
        if(!arms.length||!frames.length||!arms.every(p=>pierces(l,p))||!frames.some(p=>pierces(l,p)))continue;
        if(lines.some(o=>o!==l&&!coaxial(o.r,l.r,.12*inch)&&arms.some(p=>pierces(o,p))&&frames.some(p=>pierces(o,p))))continue;
        let lo=-90,hi=90,stop=null;
        for(const p of frames){if(p.pu<hi){hi=p.pu;stop={k:p.k,kind:p.o.slot(q,l.q,p.pr)?'slot':'cutout'};}if(-p.pd>lo)lo=-p.pd;}
        // The CAD may show it anywhere along its slot (a team draws it lifted for the bigger piece): it may have little or no
        // room left upward, as long as the slot gives it room to move.
        if(hi-lo<5)continue;
        // What swings: the arm plates, the roller, a belt round both axles, and the parts fixed to the plates (a
        // crossbar) that do not reach the frame.
        const moving=new Set([...arms.map(p=>p.k),...g]),frame=new Set(frames.map(p=>p.k)),pivot=new Set(l.members),q2=to2(l.r.center);
        const touch=(x,y)=>{const f=feat(x),h=feat(y),t=.02*inch;return [0,1,2].every(i=>f.lo[i]<=h.hi[i]+t&&h.lo[i]<=f.hi[i]+t);};
        const grow=[...arms.map(p=>p.k)];while(grow.length){const x=grow.pop();for(const k of own){if(moving.has(k)||frame.has(k)||pivot.has(k)||claimed.has(k)||!touch(x,k))continue;if([...frame].some(f=>touch(k,f)))continue;moving.add(k);grow.push(k);}}
        for(const k of own){if(moving.has(k)||claimed.has(k)||!/belt|chain/i.test(nameOf(ctx,k)))continue;const o=flat(k,a,u,w);if(inBox(o,q,.05*inch)&&inBox(o,q2,.05*inch))moving.add(k);}
        // A pulley, sprocket or gear on the pivot: the arm turns on the axle that drives its roller, as is usual.
        const plateNames=arms.map(p=>nameOf(ctx,p.k)).join(' '),drives=l.members.find(k=>/pulley|sprocket|gear/i.test(nameOf(ctx,k)));
        // The gap under the roller (in inches, floor to the roller's underside) at the bottom of its travel and at the top:
        // a piece smaller than the bottom gap passes under it at rest; a bigger one lifts it, as far as the top allows.
        const R=Math.max(r.radius,...[...g].map(k=>rev(k)?.radius||0)),gapAt=deg=>+((dot(K.math.apply(K.math.about(l.r.center,axis,deg),r.center),up)-floor-R)/inch).toFixed(2);
        return {moving,plates:arms.map(p=>p.k),origin:l.r.center,axis,lower:+Math.min(0,lo).toFixed(1),upper:+hi.toFixed(1),slot:stop,gaps:{rest:gapAt(Math.min(0,lo)),up:gapAt(hi)},
          why:`“${nameOf(ctx,l.members.find(k=>/shaft|axle/i.test(nameOf(ctx,k)))??l.members[0])}”${drives!==undefined?`, the axle that drives the roller (“${nameOf(ctx,drives)}” is on it)`:''}`,confidence:/arm|bar|link|pivot|swing|float|rocker/i.test(plateNames)?.75:.6};}
      return null;
    }
    // A part flattened along an axis: its triangles in the plane across it (u, w), with boxes for quick rejects.
    function flat(k,a,u,w){const key=k+':'+a.map(v=>v.toFixed(3)).join();let o=flats.get(key);if(o)return o;
      const T=[];let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
      for(const t of ctx.trisOf(k)){const p=ctx.index3(t).map(i=>{const v=ctx.P(i);return [dot(v,u),dot(v,w)];});const b={p,x0:Math.min(p[0][0],p[1][0],p[2][0]),x1:Math.max(p[0][0],p[1][0],p[2][0]),y0:Math.min(p[0][1],p[1][1],p[2][1]),y1:Math.max(p[0][1],p[1][1],p[2][1])};
        T.push(b);x0=Math.min(x0,b.x0);x1=Math.max(x1,b.x1);y0=Math.min(y0,b.y0);y1=Math.max(y1,b.y1);}
      // A slot rather than a cutout: material on both sides of the axle's path, close to it, halfway along.
      o={T,x0,x1,y0,y1,slot:(q,c,pr)=>{const t=Math.PI/36,x=c[0]+(q[0]-c[0])*Math.cos(t)-(q[1]-c[1])*Math.sin(t),y=c[1]+(q[0]-c[0])*Math.sin(t)+(q[1]-c[1])*Math.cos(t),rx=x-c[0],ry=y-c[1],l=Math.hypot(rx,ry)||1;
        return near2(o,x+rx/l*pr*1.6,y+ry/l*pr*1.6,pr*.4)&&near2(o,x-rx/l*pr*1.6,y-ry/l*pr*1.6,pr*.4);}};flats.set(key,o);return o;}
    // ---- other assemblies, by name: claws, wrists, lifts, slides, arms, four-bars, turrets, hooks, gates and the rest of
    // DeckMechanismTypes, from the names the team gave its assemblies (and parts) at any depth of the tree. One inside
    // another rides on it: a claw on a wrist on an arm on a lift, a game roller on the slide it sits in. Where it turns or
    // slides comes from its parts, as for the game's mechanisms (the hinge line joining it to what holds it, its rails,
    // the axle it spins on, its turntable, its fingers); with nothing to go by it is still listed, at the middle of its
    // parts, for the team to pick the pivot. Its type sets its positions, speed and which way is positive.
    const used=new Set([...intakeNames,...plans.map(p=>p.names)].flatMap(x=>x||[]).map(clean));
    const TY=root.DeckMechanismTypes||(typeof require==='function'?require('./sim-mechanism-types.js'):null),linked=[],owner=new Map();
    if(TY)named();
    function named(){
      const nodes=ctx.parts.nodes,rows3=[F,L,T],made=new Map(),list=[];
      // The game's own assemblies, the chassis and (while the game's feeders turn in them) the indexers are looked
      // inside, not at.
      const outer=new Set([...metaParts.filter(p=>used.has(clean(p.name))||p.role==='chassis'||p.role==='indexer'&&!fromNames),...metaAll.filter(holds)].flatMap(p=>[p.key,clean(p.name)]));
      // While the game's mechanisms are on, its turrets, hoods, flywheels, intakes and feeders are the ones set up for it.
      const game=new Set(fromNames?[]:['turret','hood','flywheel','roller-intake','deploy-intake','feeder']);
      // The mechanisms the team added (Configure from CAD), each given the assembly whose name is most like it
      // (DeckMechanismTypes.likeness), one assembly each, assemblies before single parts; one inside another still rides on it.
      const wanted=new Map();
      if(want.length){const cands=[];
        for(const n of nodes){const all=ctx.parts.leavesUnder(n);if(!all.length||outer.has(n.key)||outer.has(clean(n.name))||all.length>ctx.leaves*.6)continue;
          for(const w of want){const t=TY.TYPES[w.kind];if(!t||t.find==='wheel')continue;const s=TY.likeness(w,n.name);if(s<1||!(all.length>1||t.piece||n.children.length))continue;cands.push({n,w,s:s+(n.children.length?.25:0)});}}
        cands.sort((a,b)=>b.s-a.s||ctx.parts.leavesUnder(b.n).length-ctx.parts.leavesUnder(a.n).length);const took=new Set();
        for(const c of cands){if(took.has(c.w.id)||wanted.has(c.n.i))continue;took.add(c.w.id);wanted.set(c.n.i,c.w);}}
      const found=[],visit=(n,above)=>{let here=above;const all=ctx.parts.leavesUnder(n),w=wanted.get(n.i);
        if(w&&found.length<40){here={n,type:w.kind,word:bare(n.name),above,assembly:n.children.length>0,want:w.id};found.push(here);}
        else if(all.length&&!outer.has(n.key)&&!outer.has(clean(n.name))&&found.length<40){const d=TY.detect(n.name),t=d&&!game.has(d.id)&&TY.TYPES[d.id];
          // A single part named for a mechanism that is never one piece (a "Viper slide" rail, a "Spool") is part of one,
          // and same-named parts that do not touch are copies (the side plates of a four-bar, two A-arms), not one part.
          if(t&&t.find!=='wheel'&&(all.length>1||t.piece)&&!(above&&TY.TYPES[above.type].family===t.family)&&(n.children.length||all.length<2||pieces(all)===1)){here={n,type:t.id,word:d.word,above,assembly:n.children.length>0};found.push(here);}}
        for(const c of n.children)visit(c,here);};
      // How many separate pieces some parts make (touching parts are one).
      function pieces(ks){const left=new Set(ks.filter(k=>feat(k)));let n=0;const near=(a,b)=>{const p=feat(a),q=feat(b),e=.03*inch;return [0,1,2].every(i=>p.lo[i]<=q.hi[i]+e&&q.lo[i]<=p.hi[i]+e);};
        while(left.size){n++;const q=[left.values().next().value];left.delete(q[0]);while(q.length){const x=q.pop();for(const y of [...left])if(near(x,y)){left.delete(y);q.push(y);}}}return n;}
      for(const n of nodes)if(!(n.parent>=0&&nodes[n.parent]))visit(n,null);
      // Spinning parts follow the game's signal while its mechanisms are on (rollers while intaking); else route actions.
      const bindFor=t=>fromNames||!t.signal||t.signal==='wheel'?null:t.signal==='roller'?(m.intakes.length?{signal:'roller',of:'intake:0'}:null):t.signal==='flywheel'?(m.shooters.length?{signal:'flywheel',of:'shooter:0'}:null):{signal:'feeder',of:'any'};
      const claim=(j,set)=>{for(const k of set||ctx.parts.expand(j.parts)){claimed.add(k);owner.set(k,j.id);}};
      for(const f of found){
        const t=TY.TYPES[f.type],name=bare(f.n.name),under=ctx.parts.leavesUnder(f.n).filter(k=>feat(k)),ups=[];for(let a=f.above;a;a=a.above)if(made.get(a))ups.push(made.get(a));
        // Its parts: those no other mechanism took (what it rides on is still the robot to it).
        const mine=new Set(ups),free=k=>!claimed.has(k)||mine.has(owner.get(k)),own=under.filter(free);
        if(!own.length||own.length<.3*under.length){if(f.want)report.push(`“${name}” looks like your ${t.name.toLowerCase()}, but its parts already move with another mechanism.`);continue;}
        const parent=ups[0]||null,bind=bindFor(t),said=f.want?`Your ${t.name.toLowerCase()} is “${name}” in your CAD.`:`Named “${name}”, so it is ${/^[aeiou]/i.test(t.name)?'an':'a'} ${t.name.toLowerCase()}.`;
        const mark=j=>{if(j&&f.want){j.for=f.want;j.matched=name;}return j;};
        if(t.find==='claw'){const done=mark(clawOf(f.n,name,own,free,t,parent,said,bind));if(done)list.push(done);continue;}
        let j=t.find==='slide'?slideOf({name},own):t.find==='spin'?spinOf(name,own):t.find==='yaw'?yawOf(name,own):hingeOf({name},own,{free});
        // With no pivot found, an assembly the team made (or one matched to a mechanism the team added) is still listed for
        // them to place; a lone named part is not.
        if(!j&&!f.assembly&&!f.want)continue;if(!j)j=placeholder(name,own,t);const moving=[...ctx.parts.expand(j.parts)];typed(j,t,moving,bind);j.parent=parent;j.note=`${said} ${j.note}`;mark(j);
        add_(j);claim(j);made.set(f,j.id);list.push(j);
        // A pivoting slide's slides ride on it, when no assembly inside it is named for them.
        if(t.then&&!found.some(g=>g.above===f&&TY.TYPES[g.type].family==='slide')){const s=slideOf({name:`${name} slides`},own.filter(k=>owner.get(k)===j.id));
          if(s){typed(s,TY.TYPES[t.then],[],null);s.parent=j.id;s.note=`The slides of “${name}”, riding on its pivot. ${s.note}`;add_(s);claim(s);list.push(s);}}
        // A swerve module's wheel rolls with the robot and steers with the module.
        if(t.id==='swerve-steer')for(const k of moving){const r=rev(k);if(!WORDS.wheel.test(nameOf(ctx,k))||!r||r.radius*inch<.8||Math.abs(dot(r.axis,up))>.3||Math.abs(dot(r.center,up)-r.radius-floor)>.25*inch)continue;
          const w2=add_({id:uniqueId(slug(name)+'-wheel'),name:`${name} wheel`,type:'continuous',parent:j.id,parts:[`#${k}`],origin:r.center,axis:r.axis,radius:r.radius,drive:{signal:'wheel'},kind:'drive-wheel',source:'inferred',confidence:.7,
            note:`“${nameOf(ctx,k)}” touches the floor; it turns as the robot drives and steers with the module.`});claim(w2,[k]);break;}
        // What the game's finder already found inside it (rollers in a slide's intake) rides on it.
        const inside=new Set(ctx.parts.leavesUnder(f.n));for(const o of joints){if(o===j||mine.has(o.id)||o.parent&&!mine.has(o.parent))continue;const ks=ctx.parts.expand(o.parts);if(ks.size&&[...ks].every(k=>inside.has(k)))o.parent=j.id;}
      }
      if(list.length)report.push(`From the names in your CAD: ${list.slice(0,8).map(j=>`“${j.name}” (${TY.TYPES[j.kind].name.toLowerCase()})`).join(', ')}${list.length>8?` and ${list.length-8} more`:''}. Check each one on the model.`);
      // How a type moves a found joint: its positions and speed, a slide's travel from its rails, positive turns raising
      // an arm (or lowering a drop-down intake to the floor), a turntable turning counterclockwise seen from above.
      function typed(j,t,moving,bind){const travel=j.type==='prismatic'&&finite(j.upper)?j.upper:null,s=TY.settings(t.id,{bind});
        for(const k of ['states','speed','lower','upper','rpm'])delete j[k];Object.assign(j,s,{type:t.joint});
        if(travel!==null&&j.states){const keys=Object.keys(j.states),[a,b]=t.id==='linear-slide'&&Math.abs(dot(unit(j.axis),up))>.7?['down','up']:keys;j.states={[a]:0,[b]:+travel.toFixed(2)};j.lower=0;j.upper=+travel.toFixed(2);}
        if(t.find==='yaw'&&dot(j.axis,up)<0)j.axis=scale(j.axis,-1);
        else if(t.positive&&moving.length&&t.joint!=='prismatic'){const c=centroidOf(moving.map(feat).filter(Boolean)),rise=dot(sub(K.math.apply(K.math.about(j.origin,j.axis,10),c),c),up);
          if(t.positive==='raise'?rise<0:rise>0)j.axis=scale(j.axis,-1);
          if(t.positive==='lower'&&j.states&&j.parts.length){const down=swingToFloor(ctx,moving,j.origin,j.axis,{up,floor,clearance:.02*inch}),k=Object.keys(j.states)[1];if(finite(down)&&down>0){j.states[k]=down;j.note+=` Down is where it touches the floor (${down}°).`;}}}
        j.kind=t.id;return j;}
      // Found by its name only: at the middle of its parts, along the type's usual direction, for the team to place.
      function placeholder(name,own,t){return {id:uniqueId(slug(name)),name,type:t.joint,parts:refs(new Set(own)),origin:centroidOf(own.map(feat)),axis:TY.direction(t,rows3),drive:{signal:'action'},source:'inferred',confidence:.2,
        note:`Where it ${t.joint==='prismatic'?'slides':'turns'} was not found in its parts: ${t.joint==='prismatic'?'set its direction with Two points along its rails':'Pick a circle on what it turns on, or Two points along its axis'}.`};}
      // A spinning part's axle: its biggest round part (a roller, wheel, pulley or spool first) and the parts on it.
      function spinOf(name,own){const round=own.filter(k=>rev(k)&&rev(k).radius*inch>=.25);if(!round.length)return null;
        const score=k=>rev(k).radius*(/roller|wheel|fly|gecko|compliant|pulley|spool|drum|reel|prop|impeller|spindle|drill/i.test(nameOf(ctx,k))?2:1);
        const seed=round.sort((a,b)=>score(b)-score(a))[0],r=rev(seed),g=coaxGroup(seed,own,Math.max(.06*inch,r.radius*.08));
        return {id:uniqueId(slug(name)),name,type:'continuous',parts:refs(g),origin:r.center,axis:r.axis,radius:r.radius,drive:{signal:'action'},source:'inferred',confidence:.5,
          note:`Spins on the axle of “${nameOf(ctx,seed)}”${g.size>1?`, with ${g.size-1} part${g.size===2?'':'s'} on it`:''}.`};}
      // A turntable: the biggest round part with an upright axis among its parts. The whole assembly turns on it.
      function yawOf(name,own){const round=own.filter(k=>{const r=rev(k);return r&&Math.abs(dot(unit(r.axis),up))>.94&&r.radius*inch>=.4;}).sort((a,b)=>rev(b).radius-rev(a).radius);if(!round.length)return null;
        const k=round[0],r=rev(k);return {id:uniqueId(slug(name)),name,type:'revolute',parts:refs(new Set(own)),origin:r.center,axis:r.axis,radius:r.radius,drive:{signal:'action'},source:'inferred',confidence:WORDS.turntable.test(nameOf(ctx,k))?.6:.45,
          note:`Turns about the upright axis of “${nameOf(ctx,k)}”.`};}
      // A claw's fingers: the parts below it named finger, jaw, pincer..., touching parts making one finger. Each turns on
      // the hinge joining it to the rest of the claw, positive closing it (toward the others); the others follow the
      // first, so "Claw closed" closes them all. Without named fingers the claw is listed with no parts to choose them.
      function clawOf(n,name,own,free,t,parent,said,bind){
        const FINGER=/finger|\bjaws?\b|pincer|prong|\btines?\b|talon|claw ?(?:half|side|piece|arm|part)|grip(?:per)? ?(?:arm|half|side)/i,set=new Set(own),hits=[];
        const walk=(x,inside)=>{const is=inside||x!==n&&FINGER.test(x.name);if(is)for(const k of x.leaves)if(set.has(k))hits.push(k);for(const c of x.children)walk(c,is);};walk(n,false);
        const touches=(a,b)=>{const p=feat(a),q=feat(b),e=.02*inch;return [0,1,2].every(i=>p.lo[i]<=q.hi[i]+e&&q.lo[i]<=p.hi[i]+e);};
        const fingers=[],seen=new Set();for(const k of hits){if(seen.has(k))continue;const c=[k],q=[k];seen.add(k);while(q.length){const x=q.pop();for(const y of hits)if(!seen.has(y)&&touches(x,y)){seen.add(y);q.push(y);c.push(y);}}fingers.push(c);}
        const rest=new Set(own.filter(k=>!seen.has(k))),near=k=>free(k)||rest.has(k);
        const mid=fingers.length>1?centroidOf(fingers.map(c=>({area:1,center:centroidOf(c.map(feat))}))):centroidOf(own.map(feat));
        const out=fingers.slice(0,4).map((c,i)=>{const j=hingeOf({name:i?`${name} finger ${i+1}`:name},c,{free:near});if(!j)return null;
          const at=centroidOf(c.map(feat));if(len(sub(K.math.apply(K.math.about(j.origin,j.axis,10),at),mid))>len(sub(at,mid)))j.axis=scale(j.axis,-1);return j;}).filter(Boolean);
        if(!out.length){const j=placeholder(name,own,t);j.parts=[];j.note=`${said} Its fingers were not found by name (finger, jaw, pincer): choose the parts that close, then pick their pivot.`;typed(j,t,[],bind);j.parent=parent;add_(j);return j;}
        out.forEach((j,i)=>{typed(j,t,[],bind);j.parent=parent;j.note=`${said} ${i?'It follows the first finger.':`${out.length>1?`Its ${out.length} fingers close together; this one leads.`:'Its finger closes on positive turns.'}`} ${j.note}`;
          if(i){delete j.drive;delete j.states;delete j.speed;linked.push({kind:'mimic',from:out[0].id,to:j.id,ratio:1,offset:0});}add_(j);claim(j);});
        return out[0];}
    }
    // The hinge an assembly turns on: a line of round parts (hinge hardware, a servo's output, an axle) that joins it to
    // the rest of the robot. The whole assembly turns. free: the parts it may turn against (the robot, or what it rides on).
    function hingeOf(p,own,{free=k=>!claimed.has(k)}={}){
      const mine=new Set(own),ob=boxOf(own.map(feat)),pad=.1*inch,near=[];
      for(let k=0;k<ctx.leaves;k++){if(mine.has(k)||!free(k))continue;const f=feat(k);if(f&&[0,1,2].every(i=>f.lo[i]<=ob.hi[i]+pad&&f.hi[i]>=ob.lo[i]-pad))near.push(k);}
      const round=[...own,...near].filter(k=>rev(k)),lines=[];
      for(const k of round){const r=rev(k);let line=lines.find(l=>coaxial(l.r,r,.12*inch));if(!line)lines.push(line={r,members:[]});line.members.push(k);}
      const drives=[...own,...near].filter(k=>WORDS.servo.test(nameOf(ctx,k))),self=clean(p.name);
      // A pin named for the mechanism ("A Arm Pin", "Claw pivot pin") is its hinge.
      for(const l of lines){let plain=0;l.score=l.members.reduce((t,k)=>{const x=nameOf(ctx,k);if(self&&x.toLowerCase().includes(self)&&/\bpins?\b|shaft|axle|bolt/i.test(x))return t+5;if(WORDS.hinge.test(x))return t+4;if(/\bpins?\b/i.test(x))return t+2;if(WORDS.hub.test(x))return t+1.5;if(WORDS.roller.test(x))return t-2;if(WORDS.gear.test(x))return t-1;if(WORDS.shaft.test(x))plain++;return t;},0)+Math.min(1,plain*.25);
        if(l.members.some(k=>mine.has(k))&&l.members.some(k=>!mine.has(k)))l.score+=2;if(drives.some(k=>lineThrough(l.r,k,.3*inch)))l.score+=3;}
      lines.sort((a,b)=>b.score-a.score);const best=lines[0];if(!best||best.score<2)return null;
      const id=uniqueId(slug(p.name));return {id,name:String(p.name).replace(/\s*<\d+>$/,''),type:'revolute',parts:refs(new Set(own)),origin:best.r.center,axis:best.r.axis,states:{rest:0},speed:90,drive:{signal:'action'},source:'inferred',confidence:best.score>=6?.6:.45,
        note:`Turns on ${[...new Set(best.members.map(k=>`“${nameOf(ctx,k)}”`))].slice(0,3).join(', ')}, the line of round parts that joins it to the robot. Add the positions it moves to.`};
    }
    // A slide along its rails: the long parts' shared direction. The parts that do not reach the robot's own parts move.
    function slideOf(p,own){
      const rails=own.filter(k=>{const f=feat(k),s2=f.spread;return Math.sqrt(s2[2])*Math.sqrt(12)>=3*inch&&s2[2]>=12*s2[1];});if(!rails.length)return null;
      const dirs=[];for(const k of rails){const a=feat(k).axes[2],lenK=Math.sqrt(feat(k).spread[2]*12);let d=dirs.find(x=>parallel(x.a,a,8));if(!d)dirs.push(d={a,total:0,rails:[]});d.total+=lenK;d.rails.push(k);}
      dirs.sort((x,y)=>y.total-x.total);let axis=dirs[0].a;if(dot(axis,up)<0)axis=scale(axis,-1);
      // The rails touching the frame stay; everything else in the assembly rides.
      const base=new Set(),others=[];for(let k=0;k<ctx.leaves;k++)if(!own.includes(k)&&feat(k))others.push(k);
      for(const k of dirs[0].rails){const f=feat(k);if(others.some(o=>{const g=feat(o),t=.02*inch;return [0,1,2].every(i=>f.lo[i]<=g.hi[i]+t&&g.lo[i]<=f.hi[i]+t);}))base.add(k);}
      const moving=new Set(own.filter(k=>!base.has(k)));if(!moving.size||moving.size===own.length&&!base.size)return null;
      const extent=k=>{const f=feat(k);let lo=Infinity,hi=-Infinity;for(const x of [f.lo[0],f.hi[0]])for(const y of [f.lo[1],f.hi[1]])for(const z of [f.lo[2],f.hi[2]]){const d=dot([x,y,z],axis);lo=Math.min(lo,d);hi=Math.max(hi,d);}return hi-lo;};
      const travel=Math.max(...dirs[0].rails.map(extent))*.8/inch,id=uniqueId(slug(p.name));
      return {id,name:String(p.name).replace(/\s*<\d+>$/,''),type:'prismatic',parts:refs(moving),origin:feat(dirs[0].rails[0]).center,axis,lower:0,upper:+travel.toFixed(2),states:{down:0,up:+travel.toFixed(2)},speed:20,drive:{signal:'action'},source:'inferred',confidence:base.size?.45:.3,
        note:`Slides along its ${dirs[0].rails.length} rails; ${base.size?'the ones fixed to the robot stay':'check which parts stay'}. Up is 80% of the rails' length.`};
    }
    function lineThrough(r,k,pad){const f=feat(k),a=r.axis,u=perpendicular(a),w=cross(a,u);let ulo=Infinity,uhi=-Infinity,wlo=Infinity,whi=-Infinity;
      for(const x of [f.lo[0],f.hi[0]])for(const y of [f.lo[1],f.hi[1]])for(const z of [f.lo[2],f.hi[2]]){const q=sub([x,y,z],r.center),s1=dot(q,u),t1=dot(q,w);ulo=Math.min(ulo,s1);uhi=Math.max(uhi,s1);wlo=Math.min(wlo,t1);whi=Math.max(whi,t1);}
      return ulo<=pad&&uhi>=-pad&&wlo<=pad&&whi>=-pad;}
    function slug(name){const s1=String(name||'part').replace(/\s*<\d+>$/,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24);return /^[a-z]/.test(s1)?s1:'part-'+s1;}
    function uniqueId(base){let id=base,n=2;while(joints.some(j=>j.id===id))id=base.slice(0,20)+'-'+n++;return id;}
    // ---- feeders: wheels in an indexer assembly
    const indexers=metaParts.filter(p=>p.role==='indexer');let fed=0;
    for(const p of indexers){const own=[...leavesOf([p.name])].filter(k=>!claimed.has(k)&&rev(k));const groups=[];
      for(const k of own.filter(k=>WORDS.roller.test(nameOf(ctx,k))&&rev(k).radius*inch>=.3)){if(groups.some(g=>g.has(k)))continue;groups.push(coaxGroup(k,own,Math.max(.06*inch,rev(k).radius*.08)));}
      const flat=[...leavesOf([p.name])].filter(k=>!claimed.has(k)&&feat(k)&&!rev(k));wheelAxles(own,flat,groups);
      for(const g of groups){fed++;const seed=[...g][0],r=rev(seed),wheels=wheelsOn(g,flat.filter(k=>!claimed.has(k)));for(const k of wheels)g.add(k);
        add_({id:`feeder${fed}`,name:`Feeder wheels ${fed}`,type:'continuous',parts:refs(g),origin:r.center,axis:r.axis,radius:Math.max(r.radius,...wheels.map(k=>reachFrom(k,r.center,unit(r.axis)))),drive:{signal:'feeder',of:'any'},source:'inferred',confidence:.6,
          note:`Wheels on one axle in “${p.name}”${wheels.length?`, ${wheels.length} of them star or flex wheels (“${nameOf(ctx,wheels[0])}”) centred on it`:''}. They turn while the robot feeds a shot.`});for(const k of g)claimed.add(k);}}
    // ---- gears that mesh with a moving part turn with it
    // A gear beside a turret's turntable, a hood's gear rack or an arm's sector, on an axis parallel to the joint's, whose
    // teeth the moving part's own teeth reach into, turns the other way by the tooth ratio; so do the parts on its axle
    // (a hub, a shaft, a second gear), and the gears those mesh with, back toward the servos or motors (three meshes
    // deep, two servos on one pinion included). Each becomes a joint that follows the one before. Servo and motor
    // bodies stay with the frame.
    const couplings=[],inJoint=new Map();for(const j of K.order({joints})){for(const k of ctx.parts.expand(j.parts))inJoint.set(k,j.id);}
    for(const j of [...joints])if(['turret','hood','deploy','action'].includes(j.drive?.signal)&&K.dofOf(j).length===1&&j.parts.length)gearTrain(j);
    function gearTrain(j){
      const free=k=>!inJoint.has(k)||inJoint.get(k)===j.parent,axis=unit(j.axis),seen=new Set(ctx.parts.expand(j.parts)),base=j.name.split(' · ');
      const queue=[{id:j.id,center:j.origin,leaves:seen,ratio:1,depth:0}];let made=0;
      while(queue.length&&made<6){const cur=queue.shift();if(cur.depth>=3)continue;
        for(const m of meshWith(cur,axis,k=>free(k)&&!seen.has(k))){if(made>=6||seen.has(m.k))continue;debug?.push({gear:j.id,from:cur.id,part:nameOf(ctx,m.k),by:nameOf(ctx,m.by),hits:m.hits,d:+m.d.toFixed(3)});
          const r=m.r,group=new Set([m.k]);for(let k=0;k<ctx.leaves;k++){if(seen.has(k)||!free(k)||WORDS.servo.test(nameOf(ctx,k)))continue;const g=rev(k);
            if(g&&coaxial(r,g,Math.max(.08*inch,r.radius*.12))&&Math.abs(dot(sub(g.center,r.center),axis))<=2.5*inch)group.add(k);}
          for(const k of group)seen.add(k);made++;
          // Tooth counts from the names when both gears have one; else pitch radii from the measured ones (the centre
          // distance is the two pitch radii, and a gear's outside is about two teeth bigger than its pitch circle).
          const n=teethOf(m.k),pitch=r.radius*(n?n/(n+2):.94),theirs=teethOf(m.by)&&n?teethOf(m.by)/n:(m.d-pitch)/pitch;
          const id=`${j.id}gear${made}`,ratio=-cur.ratio*theirs;if(joints.some(x=>x.id===id))return;
          add_({id,name:`${base[0]} gear${made>1?' '+made:''}${base[1]?' · '+base.slice(1).join(' · '):''}`,type:'continuous',parent:j.parent||null,parts:refs(group),origin:r.center,axis,radius:r.radius,source:'inferred',confidence:Math.min(.8,j.confidence??.6),
            note:`“${nameOf(ctx,m.k)}” meshes with ${cur.depth?'the gear before it':`“${j.name}”`}, so it turns ${Math.abs(ratio).toFixed(2)}× as far ${ratio<0?'the other way':'the same way'}${group.size>1?`, with ${group.size-1} part${group.size>2?'s':''} on its axle`:''}.`});
          couplings.push({kind:'gear',from:cur.id,to:id,ratio:+(-theirs).toFixed(4),offset:0});for(const k of group)claimed.add(k);
          queue.push({id,center:r.center,leaves:group,ratio,depth:cur.depth+1});}}
    }
    // The gears (not already moving) that mesh with a set of parts turning about axis through cur.center, most teeth
    // first: their teeth and the set's overlap on the side facing that axis, in a part lying across the axis (a gear,
    // a sector or a curved rack, not a plate standing along it). One per axle.
    function meshWith(cur,axis,ok){
      const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const k of cur.leaves){const f=feat(k);if(f)for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],f.lo[i]);hi[i]=Math.max(hi[i],f.hi[i]);}}
      const found=[];
      for(let k=0;k<ctx.leaves;k++){if(!ok(k))continue;const r=rev(k),name=nameOf(ctx,k);if(!r||!parallel(r.axis,axis,6)||r.radius*inch<.15||r.radius*inch>4)continue;
        if(!(WORDS.gear.test(name)||teethOf(k))||/pulley|sprocket|belt|chain/i.test(name)||WORDS.servo.test(name))continue;
        const d=lineDistance(r.center,cur.center,axis);if(d<r.radius*1.1)continue;
        const pad=r.radius*1.05;if(![0,1,2].every(i=>r.center[i]+pad>=lo[i]&&r.center[i]-pad<=hi[i]))continue;
        // toward: to the other axis, at right angles to this one. by: the part of the moving set whose teeth reach in
        // most (the gear that meshes, for its tooth count).
        const off=sub(cur.center,r.center),toward=unit(sub(off,scale(axis,dot(off,axis))));let hits=0,by=null,most=0;
        for(const q of cur.leaves){const f=feat(q);if(!f||![0,1,2].every(i=>f.lo[i]<=r.center[i]+pad&&f.hi[i]>=r.center[i]-pad))continue;
          // Only a gear has teeth: named as one (a gear, pinion, sector or rack, or with a tooth count), or round about
          // the moving set's own axis (a turntable). A plate beside the gear is not one.
          const qn=nameOf(ctx,q),qr=rev(q);if(!((WORDS.gear.test(qn)||/sector|rack/i.test(qn)||teethOf(q))&&!/pulley|sprocket/i.test(qn)||qr&&parallel(qr.axis,axis,6)&&lineDistance(qr.center,cur.center,axis)<.1*inch))continue;
          // Its width along the axis and across it: a part standing along the axis has no teeth turning about it.
          const size=[0,1,2].map(i=>f.hi[i]-f.lo[i]),t=[0,1,2].reduce((s,i)=>s+Math.abs(axis[i])*size[i],0),across=Math.max(...[0,1,2].map(i=>size[i]*Math.sqrt(Math.max(0,1-axis[i]*axis[i]))));
          if(t>1.5*across)continue;const before=hits;
          // Teeth of a gear wider or narrower than this one: its faces may lie outside this gear's, within its own width.
          const reach=r.length/2+t,v=ctx.vertsOf(q),stride=Math.max(1,Math.floor(v.length/20000));
          for(let i=0;i<v.length;i+=stride){const p=sub(ctx.P(v[i]),r.center),h=dot(p,axis);if(Math.abs(h)>reach)continue;
            const radial=sub(p,scale(axis,h)),rho=len(radial);if(rho<.5*r.radius||rho>1.02*r.radius||dot(radial,toward)<.5*rho)continue;hits++;}
          if(hits-before>most){most=hits-before;by=q;}}
        if(hits>=4)found.push({k,r,d,hits,by});}
      found.sort((a,b)=>b.hits-a.hits);return found.filter((m,i)=>!found.slice(0,i).some(o=>coaxial(o.r,m.r,Math.max(.08*inch,o.r.radius*.12))));
    }
    // ---- how far each hood that follows the launch angle can tilt before it meets another part (boxes round the parts,
    // as Check clearance sweeps them), kept as its limits so tilting to a launch angle never drives it into the turret
    const C=root.DeckCollide||(typeof require==='function'?require('./sim-collide.js'):null);
    for(const j of joints){if(!C||j.drive?.signal!=='hood'||!finite(j.launch))continue;
      try{const s=C.sweep(ctx,K.sanitize({joints}),j.id,{from:0,lower:-45,upper:45,step:1.5,points:true});j.lower=s.free[0];j.upper=s.free[1];
        j.note+=` It tilts ${s.free[0]}° to ${s.free[1]}° before it meets other parts, so its shots leave between ${(j.launch+s.free[0]).toFixed(0)}° and ${(j.launch+s.free[1]).toFixed(0)}°.`;}catch{}}
    // ---- drive wheels: round parts named like wheels (or treads and tires) whose axis lies flat. A wheel's tread, tire and
    // hub turn about one axis: they are one wheel, the biggest of them its size. The drive wheels are the lowest of these,
    // all at one height: a spring-loaded odometry pod drawn fully out hangs below them, so the CAD's lowest point is not
    // where the wheels stand. Their bottoms must agree with each other and be near the floor (within 1.5 in).
    let w=0;{const {wheels,lift}=driveWheels(ctx,{up,inch,floor,skip:claimed});
      for(const g of wheels){w++;const name=g.name,r=g.r;
        add_({id:`wheel${w}`,name:`Drive wheel ${w}`,type:'continuous',parts:g.leaves.map(k=>`#${k}`),origin:r.center,axis:dot(r.axis,unit3(L))>=0?r.axis:scale(r.axis,-1),radius:r.radius,drive:{signal:'wheel'},...(/mecanum/i.test(name)?{roll:'mecanum'}:/omni/i.test(name)?{roll:'omni'}:{}),source:'inferred',confidence:.8,note:`“${name}” is round, lies flat and stands with the other wheels; it turns as the robot drives.`});for(const k of g.leaves)claimed.add(k);}
      if(wheels.length&&lift>.25*inch)report.push(`The wheels stand ${(lift/inch).toFixed(2)} in above the CAD's lowest part (an odometry pod drawn fully out, perhaps).`);}
    if(w)report.push(`${w} drive wheel${w>1?'s':''} found; they turn as the robot drives.`);
    // What each part the game's finder found is (DeckMechanismTypes), for the panel's labels and defaults; a claw's other
    // fingers follow its first.
    if(TY)for(const j of joints)if(!j.kind){const t=TY.of(j),s=j.drive?.signal;if(!t)continue;
      j.kind=s==='deploy'&&/^kicker/i.test(j.name)?'kicker':s==='wheel'&&TY.detect(nameOf(ctx,[...ctx.parts.expand(j.parts)][0]),{vendor:true})?.id==='odometry-pod'?'odometry-pod':t.id;}
    couplings.push(...linked);
    // From part names alone, a game mechanism's ramp, kicker or hood is moved by route actions: "Ramp down", "Hood shoot".
    if(fromNames)for(const j of joints){const d=j.drive?.signal;
      if(d==='deploy'){j.drive={signal:'action'};j.states={up:j.states.raised,down:j.states.lowered};j.speed=Math.abs(j.states.down-j.states.up)/.3||90;j.name=j.name.split(' · ')[0];}
      else if(d==='float'){j.drive={signal:'action'};j.name=j.name.split(' · ')[0];}
      else if(d==='hood'){j.drive={signal:'action'};j.name=j.name.replace(' · shooter','');}
      else if(d==='turret'){j.drive={signal:'action'};j.states={front:-(j.zero||0)};j.name=j.name.replace(' · shooter','');}
      else if(d&&d!=='wheel'&&d!=='action')delete j.drive;
      j.name=j.name.replace(/ · (shooter|intake) /,' ');}
    // Route actions find parts by name, so names are unique.
    for(const j of joints){const same=joints.filter(x=>x.name===j.name);if(same.length>1)same.forEach((x,i)=>{if(i)x.name+=' '+(i+1);});}
    for(const j of joints){j.origin=j.origin.map(v=>+v.toFixed(4));j.axis=unit(j.axis).map(v=>+v.toFixed(6));if(j.radius)j.radius=+j.radius.toFixed(4);}
    return {joints,couplings,report,intakes:fromNames?[]:kinds};
  }
  // A gear's tooth count from its name: "Spur gear (24 teeth)", "100t Hub Mount Gear", "9 Tooth", "24 Pinion Gear", "MOD 1 (24T)".
  const TEETH=/(?<![\d.])(\d{1,3})\s*-?\s*(?:t|teeth|tooth)\b|^\s*(\d{1,3})\s+(?:pinion|spur|gear)\b/i;
  function teethOfName(name){const x=TEETH.exec(String(name||''));const n=x?+(x[1]||x[2]):NaN;return n>=6&&n<=400?n:null;}
  const unit3=v=>unit(Array.isArray(v)?v:[0,0,1]);
  function boxOf(fs){const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const f of fs)for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],f.lo[i]);hi[i]=Math.max(hi[i],f.hi[i]);}return {lo,hi};}
  function centroidOf(fs){let A=0;const c=[0,0,0];for(const f of fs){A+=f.area;for(let i=0;i<3;i++)c[i]+=f.area*f.center[i];}return A?scale(c,1/A):c;}
  // ---------------------------------------------------------------- the drive wheels
  // Round parts named like wheels (or treads and tires) whose axis lies flat (across up). A wheel's tread, tire and hub
  // turn about one axis: they are one wheel, the biggest of them its size. The drive wheels are the lowest of these, all at
  // one height: a spring-loaded odometry pod drawn fully out hangs below them, so the CAD's lowest point is not where the
  // wheels stand. Their bottoms must agree with each other and be near the floor (within 1.5 in). inch: CAD units per
  // inch; floor: the CAD's lowest point along up (found when not given); skip: parts already taken.
  // Returns {wheels:[{k, r (its revolve), leaves, name}], lift (how far above the floor they stand)}.
  function driveWheels(ctx,{up,inch=1,floor,skip=new Set()}){const u=unit(up);
    if(!finite(floor)){floor=Infinity;for(let v=0;v<ctx.positions.length/3;v+=Math.max(1,Math.floor(ctx.positions.length/3/200000)))floor=Math.min(floor,dot(ctx.P(v),u));}
    const groups=[];for(let k=0;k<ctx.leaves;k++){const n=nameOf(ctx,k);if(skip.has(k)||!(WORDS.wheel.test(n)||/tread|tire|tyre/i.test(n)))continue;const r=feature(ctx,k)?.revolve;if(!r||r.radius/inch<.8||Math.abs(dot(r.axis,u))>.3)continue;
      const g=groups.find(o=>coaxial(o.r,r,Math.max(.1*inch,.15*Math.max(o.r.radius,r.radius)))&&len(sub(o.r.center,r.center))<Math.max(o.r.radius,r.radius));if(g){g.leaves.push(k);if(r.radius>g.r.radius){g.r=r;g.k=k;}}else groups.push({k,r,leaves:[k]});}
    if(!groups.length)return {wheels:[],lift:0};
    const bottom=g=>dot(g.r.center,u)-g.r.radius,low=Math.min(...groups.map(bottom));
    return {wheels:groups.filter(g=>bottom(g)-low<=.25*inch&&low-floor<=1.5*inch).map(g=>({...g,name:nameOf(ctx,g.k)})),lift:low-floor};}
  // ---------------------------------------------------------------- odometry pods
  // Dead-wheel pods: round parts 0.8–2.4 in across whose axle lies flat, in a part or assembly named like a pod (goBILDA's
  // 3110-0001/3110-0002 swingarm pods, "odometry", "dead wheel", "tracking wheel"). A CAD often draws one pod several times
  // (resting, retracted, fully out): copies within 1.5 in are one pod, and the one drawn at rest ("0°") is kept.
  // Returns [{center, axis, radius, name, path, leaves}] in the CAD's frame.
  const POD_WORDS=/odometry|\bodo\b|dead ?wheel|tracking wheel|3110-000[12]|swing ?arm pod|\bpod\b/i;
  // The top assembly's own name is left out (a robot called "Kiwi Swerve Odometry" is not all pods), and so are the drive wheels.
  function odometryPods(ctx,{up,inch=1}){const u=unit(up),found=[],drive=new Set(driveWheels(ctx,{up,inch}).wheels.flatMap(g=>g.leaves));
    for(let k=0;k<ctx.leaves;k++){if(drive.has(k))continue;const path=String(ctx.parts.key(k)||'').split('/').slice(1).join('/'),name=nameOf(ctx,k);if(!POD_WORDS.test(path)&&!POD_WORDS.test(name))continue;const r=feature(ctx,k)?.revolve;
      if(!r||r.radius/inch<.4||r.radius/inch>1.2||Math.abs(dot(r.axis,u))>.3)continue;
      const g=found.find(o=>coaxial(o,r,Math.max(.1*inch,.15*Math.max(o.radius,r.radius)))&&len(sub(o.center,r.center))<Math.max(o.radius,r.radius));
      if(g){g.leaves.push(k);if(r.radius>g.radius)Object.assign(g,{center:r.center,axis:r.axis,radius:r.radius});}else found.push({center:r.center,axis:r.axis,radius:r.radius,name,path,leaves:[k]});}
    const pods=[];for(const p of found){const near=pods.find(o=>len(sub(o.center,p.center))<1.5*inch);if(!near){pods.push(p);continue;}if(/\(0°\)|\b0 ?deg|rest/i.test(p.path)&&!/\(0°\)|\b0 ?deg|rest/i.test(near.path))Object.assign(near,p);}
    return pods;}
  // ---------------------------------------------------------------- a wheel clicked on the model
  // The wheels that a click at point (CAD frame, on part leaf) may mean: round parts whose axis lies flat (across up), at
  // least 0.8 in across, that the click is on or right beside (the tread, the hub, a side plate or the holder round it).
  // A wheel's tread, tire and hub turn about one axis, so coaxial ones are one wheel and the biggest is its size. Each:
  // {center, axis, radius (CAD units), leaves, name, has (the clicked part is in it), dist (click to centre)}.
  // inch: CAD units per inch. With none round enough, the clicked part's box centre ({center, box: true}).
  function wheelsNear(ctx,{leaf,point,up,inch=1}){
    const reach=4*inch,u=unit(up),out=[];
    // A quick box test before the shape: only parts within 4 in of the click. Each part's box is found once per CAD.
    let boxes=ctx.cache.get('leafBoxes');if(!boxes){boxes=new Float64Array(ctx.leaves*6).fill(NaN);for(let k=0;k<ctx.leaves;k++){const v=ctx.vertsOf(k);if(!v.length)continue;const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<v.length;i+=Math.max(1,Math.floor(v.length/400))){const p=ctx.P(v[i]);for(let q=0;q<3;q++){if(p[q]<lo[q])lo[q]=p[q];if(p[q]>hi[q])hi[q]=p[q];}}boxes.set([...lo,...hi],k*6);}ctx.cache.set('leafBoxes',boxes);}
    for(let k=0;k<ctx.leaves;k++){if(Number.isNaN(boxes[k*6]))continue;let far=false;
      for(let q=0;q<3;q++)if(point[q]<boxes[k*6+q]-reach||point[q]>boxes[k*6+3+q]+reach)far=true;if(far)continue;
      const r=feature(ctx,k)?.revolve;if(!r||r.radius<.4*inch||Math.abs(dot(r.axis,u))>.3)continue;
      const d=sub(point,r.center),along=Math.abs(dot(d,r.axis));if(lineDistance(point,r.center,r.axis)>r.radius+inch||along>r.length/2+1.5*inch)continue;
      const g=out.find(o=>coaxial(o,r,Math.max(.1*inch,.15*Math.max(o.radius,r.radius)))&&len(sub(o.center,r.center))<Math.max(o.radius,r.radius));
      if(g){g.leaves.push(k);if(r.radius>g.radius)Object.assign(g,{center:r.center,axis:r.axis,radius:r.radius,name:nameOf(ctx,k)});g.has||=k===leaf;}
      else out.push({center:r.center,axis:r.axis,radius:r.radius,length:r.length,leaves:[k],name:nameOf(ctx,k),has:k===leaf});}
    for(const g of out)g.dist=len(sub(point,g.center));
    if(out.length)return out;
    const f=feature(ctx,leaf);return f?[{center:scale(add(f.lo,f.hi),.5),radius:0,leaves:[leaf],name:nameOf(ctx,leaf),has:true,dist:0,box:true}]:[];
  }
  return {prepare,feature,roundAbout,fitAt,fitCircle,ransacCircle,eigen,swingToFloor,discover,coaxial,teethOfName,wheelsNear,driveWheels,odometryPods,WORDS};
});
