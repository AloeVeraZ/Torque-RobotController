(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(()=>require('./vendor/planning.cjs'));else root.DeckPlanner=factory(()=>root.DeckPlanningLibs);})(typeof globalThis==='object'?globalThis:this,libs=>{
  'use strict';
  // Field frame: inches, bottom-left origin, +X right, +Y up, heading CCW in degrees.
  // The robot keeps its starting heading along the route, so obstacles are grown by the
  // exact footprint at that heading (a Minkowski sum) plus the requested clearance.
  const SIZE=144,EPS=1e-9,SCALE=1e4,TOL=1e-3,MIN_CLEARANCE=.05,rad=d=>d*Math.PI/180,dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  // Clipper stores integers at 1e-4 inch, so a union vertex can sit up to ~7e-5 inch inside a
  // neighbouring grown polygon. TOL (10x that) classifies such points as ON the boundary.
  const finite=n=>typeof n==='number'&&Number.isFinite(n),clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const FIELD={x0:0,y0:0,x1:SIZE,y1:SIZE};
  function polygon(zone){
    if(zone.type==='polygon')return zone.points.map(q=>({x:q.x,y:q.y}));
    let p;if(zone.type==='circle'){const count=24,r=zone.radius/Math.cos(Math.PI/count);p=Array.from({length:count},(_,i)=>({x:r*Math.cos(i*2*Math.PI/count),y:r*Math.sin(i*2*Math.PI/count)}));}
    else if(zone.type==='triangle')p=[{x:-zone.width/2,y:-zone.height/2},{x:zone.width/2,y:-zone.height/2},{x:0,y:zone.height/2}];
    else p=[{x:-zone.width/2,y:-zone.height/2},{x:zone.width/2,y:-zone.height/2},{x:zone.width/2,y:zone.height/2},{x:-zone.width/2,y:zone.height/2}];
    const c=Math.cos(rad(zone.angle||0)),s=Math.sin(rad(zone.angle||0));return p.map(v=>({x:zone.x+v.x*c-v.y*s,y:zone.y+v.x*s+v.y*c}));
  }
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const area=p=>p.reduce((s,q,i)=>{const r=p[(i+1)%p.length];return s+q.x*r.y-r.x*q.y;},0)/2;
  function convex(p){let sign=0;for(let i=0;i<p.length;i++){const c=cross(p[i],p[(i+1)%p.length],p[(i+2)%p.length]);if(Math.abs(c)<1e-9)continue;if(sign&&Math.sign(c)!==sign)return false;sign=Math.sign(c);}return true;}
  // Ear clipping for a simple polygon; null when the outline crosses itself.
  function triangulate(points){
    let p=points.slice();if(area(p)<0)p.reverse();const out=[];let guard=0;
    while(p.length>3&&guard++<500){
      let clipped=false;
      for(let i=0;i<p.length;i++){const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length];if(cross(a,b,c)<=1e-9)continue;
        if(p.some(q=>q!==a&&q!==b&&q!==c&&cross(a,b,q)>=-1e-9&&cross(b,c,q)>=-1e-9&&cross(c,a,q)>=-1e-9))continue;
        out.push([a,b,c]);p.splice(i,1);clipped=true;break;}
      if(!clipped)return null;
    }
    if(p.length===3)out.push(p);return out;
  }
  // Two non-adjacent edges that touch or cross mean the outline is not a simple polygon.
  function selfCrossing(p){
    const n=p.length,hits=(a,b,c,d)=>{const d1=cross(c,d,a),d2=cross(c,d,b),d3=cross(a,b,c),d4=cross(a,b,d);return ((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0));};
    for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){if(i===0&&j===n-1)continue;if(hits(p[i],p[(i+1)%n],p[j],p[(j+1)%n]))return true;}
    return false;
  }
  // Outer perimeter of a crossing sketch: split edges where they meet, then walk the outside
  // keeping the exterior on the left. Interior lines disappear and concave corners survive.
  // Returns null when the outside pinches through a single point (an hourglass).
  function outline(p){
    const n=p.length,keys=new Map(),verts=[],adj=[],key=q=>Math.round(q.x*1e6)+','+Math.round(q.y*1e6);
    // Corners snap to the key grid, so validating a stored outline again reproduces it exactly.
    const vertex=q=>{const k=key(q);if(!keys.has(k)){keys.set(k,verts.length);verts.push({x:Math.round(q.x*1e6)/1e6,y:Math.round(q.y*1e6)/1e6});adj.push(new Set());}return keys.get(k);};
    for(let i=0;i<n;i++){const a=p[i],b=p[(i+1)%n],dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy,ts=[0,1];if(len2<EPS)continue;
      for(let j=0;j<n;j++){if(j===i)continue;const c=p[j],d=p[(j+1)%n],ex=d.x-c.x,ey=d.y-c.y,den=dx*ey-dy*ex;
        for(const q of [c,d]){const t=((q.x-a.x)*dx+(q.y-a.y)*dy)/len2;if(t>0&&t<1&&Math.abs(cross(a,b,q))/Math.sqrt(len2)<1e-7)ts.push(t);}
        if(Math.abs(den)<1e-12)continue;const t=((c.x-a.x)*ey-(c.y-a.y)*ex)/den,u=((c.x-a.x)*dy-(c.y-a.y)*dx)/den;if(t>0&&t<1&&u>=0&&u<=1)ts.push(t);}
      ts.sort((x,y)=>x-y);let prev=vertex(a);
      for(const t of ts.slice(1)){const next=vertex({x:a.x+dx*t,y:a.y+dy*t});if(next!==prev){adj[prev].add(next);adj[next].add(prev);}prev=next;}}
    let start=0;verts.forEach((q,i)=>{if(q.x<verts[start].x||(q.x===verts[start].x&&q.y<verts[start].y))start=i;});
    const ring=[],seen=new Set(),angle=(from,to)=>Math.atan2(verts[to].y-verts[from].y,verts[to].x-verts[from].x);
    let back=Math.PI,at=start,from=-1;
    for(let guard=0;guard<=verts.length*2;guard++){
      let best=-1,bestTurn=Infinity;
      for(const w of adj[at]){let turn=(back-angle(at,w))%(2*Math.PI);if(turn<=1e-12)turn+=2*Math.PI;if(w===from&&adj[at].size>1)turn=Infinity;if(turn<bestTurn){bestTurn=turn;best=w;}}
      if(best<0)return null;
      if(at===start&&ring.length&&best===ring[1])break;
      if(seen.has(at))return null;seen.add(at);ring.push(at);
      back=angle(best,at);from=at;at=best;
    }
    if(ring.length<3)return null;
    const out=ring.map(i=>verts[i]).filter((q,i,a)=>Math.abs(cross(a[(i+a.length-1)%a.length],q,a[(i+1)%a.length]))>1e-9);
    return out.length>=3&&out.length<=40&&triangulate(out)?out:null;
  }
  // Convex pieces of a zone. A self-crossing outline is treated as its whole hull (safe side).
  function parts(zone){
    const p=polygon(zone);if(zone.type!=='polygon'||p.length<=3||convex(p))return [p];
    if(selfCrossing(p))return [hull(p)];
    return triangulate(p)||[hull(p)];
  }
  const zoneHits=(shape,zone)=>parts(zone).some(q=>overlap(shape,q));
  function hull(points){const sorted=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y),lower=[],upper=[];for(const p of sorted){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=EPS)lower.pop();lower.push(p);}for(const p of sorted.slice().reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=EPS)upper.pop();upper.push(p);}return lower.slice(0,-1).concat(upper.slice(0,-1));}
  function footprintOf(raw){const f=raw||{front:9,rear:9,half:9};if(![f.front,f.rear,f.half].every(n=>finite(n)&&n>0))throw Error('Robot footprint dimensions must be positive finite inches.');return {front:f.front,rear:f.rear,half:f.half};}
  function body(pose,footprint={front:9,rear:9,half:9}){const c=Math.cos(rad(pose.heading)),s=Math.sin(rad(pose.heading));return [{x:footprint.front,y:footprint.half},{x:-footprint.rear,y:footprint.half},{x:-footprint.rear,y:-footprint.half},{x:footprint.front,y:-footprint.half}].map(p=>({x:pose.x+p.x*c-p.y*s,y:pose.y+p.x*s+p.y*c}));}
  // Visibility checks need only a boundary tolerance, not the actual distance.
  // Compare squared distances to avoid a square root for every polygon edge.
  function nearBoundary(p,poly,tol){const limit=tol*tol;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/l,0,1):0,x=p.x-a.x-dx*t,y=p.y-a.y-dy*t;if(x*x+y*y<=limit)return true;}return false;}
  // A point outside the polygon's bounding box is outside it: most tests end here (the box is cached on the polygon).
  const outsideBox=(p,poly)=>{const b=poly.box||(poly.box=boxOf(poly));return p.x<b.x0||p.x>b.x1||p.y<b.y0||p.y>b.y1;};
  function rayInside(p,poly){if(outsideBox(p,poly))return false;let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[j],b=poly[i];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
  // Strictly inside by more than `tol`: boundary points (within tol) are free space.
  const inside=(p,poly,tol=TOL)=>rayInside(p,poly)&&!nearBoundary(p,poly,tol);
  // Kept for callers that used the old name: strict=true means "inside, not on the boundary".
  function contains(p,poly,strict=false){return strict?inside(p,poly,1e-7):rayInside(p,poly)||nearBoundary(p,poly,1e-7);}
  function overlap(a,b,eps=1e-7){for(const shape of [a,b])for(let i=0;i<shape.length;i++){
    const p=shape[i],q=shape[(i+1)%shape.length],axis={x:p.y-q.y,y:q.x-p.x},len=Math.hypot(axis.x,axis.y)||1,dot=v=>(v.x*axis.x+v.y*axis.y)/len,A=a.map(dot),B=b.map(dot);
    if(Math.max(...A)<=Math.min(...B)+eps||Math.max(...B)<=Math.min(...A)+eps)return false;
  }return true;}
  const inField=(points,field)=>points.every(p=>p.x>=field.x0-1e-7&&p.y>=field.y0-1e-7&&p.x<=field.x1+1e-7&&p.y<=field.y1+1e-7);
  function safePose(pose,zones,footprint,field=FIELD){if(!pose||![pose.x,pose.y,pose.heading].every(finite))return false;const corners=body(pose,footprint);return inField(corners,field)&&!zones.some(z=>zoneHits(corners,z));}
  // Exact swept check for a straight move at constant heading: the swept region of a convex
  // footprint is the convex hull of its start and end placements.
  function sweepClear(a,b,heading,zones,footprint,field=FIELD){const swept=hull([...body({...a,heading},footprint),...body({...b,heading},footprint)]);return inField(swept,field)&&!zones.some(z=>zoneHits(swept,z));}
  // Stop at the first contact, including fast pointer movements across a thin barrier.
  function dragPose(from,to,zones,footprint,field=FIELD){
    const at=t=>({x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,heading:from.heading});
    if(sweepClear(from,to,from.heading,zones,footprint,field))return at(1);
    let lo=0,hi=1;for(let i=0;i<28;i++){const mid=(lo+hi)/2;if(sweepClear(from,at(mid),from.heading,zones,footprint,field))lo=mid;else hi=mid;}
    return at(lo);
  }
  // Drag that slides along whatever stops it: after the first contact, the rest of the move
  // continues along each axis that is still free. A robot that starts overlapping a red area
  // moves freely until it is clear.
  function slidePose(from,to,zones,footprint,field=FIELD){
    if(!safePose(from,zones,footprint,field))return {x:to.x,y:to.y,heading:from.heading};
    const p=dragPose(from,to,zones,footprint,field);if(dist(p,to)<1e-6)return p;
    const a=dragPose(p,{x:to.x,y:p.y},zones,footprint,field);return dragPose(a,{x:a.x,y:to.y},zones,footprint,field);
  }
  // Sampled sweep for moves that also turn (rotation makes the swept region non-convex).
  function safeSweep(a,b,zones,footprint,field=FIELD){const angle=((b.heading-a.heading+540)%360)-180;if(Math.abs(angle)<1e-9)return sweepClear(a,b,a.heading,zones,footprint,field);const n=Math.max(1,Math.ceil(dist(a,b)/.1),Math.ceil(Math.abs(angle)));for(let i=0;i<=n;i++){const t=i/n;if(!safePose({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,heading:a.heading+angle*t},zones,footprint,field))return false;}return true;}
  function inflated(zones,footprint,heading,clearance){const offsets=body({x:0,y:0,heading},footprint).map(p=>({x:-p.x,y:-p.y}));const ring=clearance>0?Array.from({length:16},(_,i)=>({x:clearance/Math.cos(Math.PI/16)*Math.cos(i*Math.PI/8),y:clearance/Math.cos(Math.PI/16)*Math.sin(i*Math.PI/8)})):[{x:0,y:0}];return zones.flatMap(zone=>parts(zone).map(part=>hull(part.flatMap(p=>offsets.flatMap(q=>ring.map(r=>({x:p.x+q.x+r.x,y:p.y+q.y+r.y})))))));}
  function boxOf(poly){const xs=poly.map(p=>p.x),ys=poly.map(p=>p.y);return {x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)};}
  function segmentClear(a,b,polys,tol=TOL){
    for(const poly of polys){const box=poly.box||(poly.box=boxOf(poly));if(Math.max(a.x,b.x)<box.x0-tol||Math.min(a.x,b.x)>box.x1+tol||Math.max(a.y,b.y)<box.y0-tol||Math.min(a.y,b.y)>box.y1+tol)continue;
      if(inside(a,poly,tol)||inside(b,poly,tol))return false;
      const ts=[0,1],dx=b.x-a.x,dy=b.y-a.y;
      for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],ex=q.x-p.x,ey=q.y-p.y,den=dx*ey-dy*ex;if(Math.abs(den)<1e-12)continue;const t=((p.x-a.x)*ey-(p.y-a.y)*ex)/den,u=((p.x-a.x)*dy-(p.y-a.y)*dx)/den;if(t>0&&t<1&&u>=-1e-9&&u<=1+1e-9)ts.push(t);}
      ts.sort((x,y)=>x-y);for(let i=1;i<ts.length;i++){if(ts[i]-ts[i-1]<1e-12)continue;const t=(ts[i-1]+ts[i])/2;if(inside({x:a.x+dx*t,y:a.y+dy*t},poly,tol))return false;}
    }return true;
  }
  function validateZone(raw){
    if(raw?.type==='polygon'){
      if(!Array.isArray(raw.points)||raw.points.length<2||raw.points.length>40||!raw.points.every(q=>q&&finite(q.x)&&finite(q.y)))throw Error('A shape needs 2 to 40 points.');
      let points=raw.points.map(q=>({x:q.x,y:q.y})).filter((q,i,a)=>!i||dist(q,a[i-1])>EPS);
      if(points.length>2&&dist(points[0],points.at(-1))<EPS)points.pop();
      if(points.length<2)throw Error('Add at least two distinct corners.');
      // A crossing gesture describes one solid body. Store its outer perimeter,
      // so rendering, handles, planning and physics all use the same simple outline.
      // Concave corners are kept; an outline that pinches to a point becomes its hull.
      if(points.length>2&&(selfCrossing(points)||!triangulate(points)))points=outline(points)||hull(points);
      if(points.length>2&&Math.abs(area(points))<EPS)throw Error('Add a corner away from the line to make a solid shape.');
      if(points.length===2&&dist(points[0],points[1])<.25)throw Error('Make the wall at least 0.25 inches long.');
      return {id:String(raw.id||'zone').slice(0,80),type:'polygon',points,x:points.reduce((s,q)=>s+q.x,0)/points.length,y:points.reduce((s,q)=>s+q.y,0)/points.length,angle:0};
    }
    if(!raw||!['rect','circle','triangle'].includes(raw.type)||![raw.x,raw.y].every(finite))throw Error('Invalid barrier.');
    const z={id:String(raw.id||'zone').slice(0,80),type:raw.type,x:raw.x,y:raw.y,angle:finite(raw.angle)?raw.angle%360:0};
    if(z.type==='circle'){if(!finite(raw.radius)||raw.radius<.25)throw Error('Barrier radius must be at least 0.25 inches.');z.radius=raw.radius;}
    else{if(![raw.width,raw.height].every(n=>finite(n)&&n>=.25))throw Error('Barrier size must be at least 0.25 inches.');z.width=raw.width;z.height=raw.height;}
    return z;
  }
  function fieldOf(raw){const f=raw||FIELD;if(![f.x0,f.y0,f.x1,f.y1].every(finite)||f.x1-f.x0<1||f.y1-f.y0<1)throw Error('Invalid field bounds.');return {x0:f.x0,y0:f.y0,x1:f.x1,y1:f.y1};}
  // A point on a Bezier curve of any degree, evaluated with de Casteljau's algorithm.
  function bezier(points,t){let p=points.map(q=>({x:q.x,y:q.y}));while(p.length>1)p=p.slice(1).map((q,i)=>({x:p[i].x+(q.x-p[i].x)*t,y:p[i].y+(q.y-p[i].y)*t}));return p[0];}
  // Shared validation for every planner: pins, zones, start pose and clearance.
  function prepare(project,rawFootprint,fieldZones,rawField){
    if(!project||!Array.isArray(project.pins)||project.pins.length>32||!Array.isArray(project.zones)||project.zones.length>24)throw Error('Use at most 32 pins and 24 barriers.');
    const footprint=footprintOf(rawFootprint),field=fieldOf(rawField);
    const start=project.start;if(!start||![start.x,start.y,start.heading].every(finite))throw Error('Choose a finite starting pose.');
    const zones=project.zones.map(validateZone),all=zones.concat(fieldZones.map(validateZone));
    if(!safePose(start,all,footprint,field))throw Error('The starting footprint overlaps a barrier, a field element or the wall. Move it to a clear position.');
    const pins=project.pins.map((p,i)=>{if(!p||![p.x,p.y].every(finite)||p.x<field.x0||p.y<field.y0||p.x>field.x1||p.y>field.y1)throw Error(`Pin ${i+1} must be inside the field.`);return {...pinEffects(p),x:p.x,y:p.y,pin:true};});
    if(!pins.length)throw Error('Add a destination pin on the field first.');
    const clearance=Math.max(MIN_CLEARANCE,finite(project.clearance)?project.clearance:1);
    return {footprint,field,start,all,pins,clearance};
  }
  // Free space for the robot centre at one fixed heading: obstacles grown by the footprint at that
  // heading plus clearance, and the centre box that keeps every corner inside the field. The
  // visibility graph between grown corners is built on first use.
  function space(all,footprint,field,heading,clearance){
    const polys=inflated(all,footprint,heading,clearance),offsets=body({x:0,y:0,heading},footprint);for(const p of polys)p.box=boxOf(p);
    const bounds={x0:field.x0-Math.min(...offsets.map(p=>p.x)),x1:field.x1-Math.max(...offsets.map(p=>p.x)),y0:field.y0-Math.min(...offsets.map(p=>p.y)),y1:field.y1-Math.max(...offsets.map(p=>p.y))};
    const within=p=>p.x>=bounds.x0-1e-7&&p.x<=bounds.x1+1e-7&&p.y>=bounds.y0-1e-7&&p.y<=bounds.y1+1e-7;
    const s={heading,polys,bounds,within,free:p=>within(p)&&!polys.some(poly=>inside(p,poly)),clear:(a,b)=>within(b)&&segmentClear(a,b,polys)};
    let built=null;s.visibility=()=>{if(built)return built;
      const {ClipperLib}=libs();if(!ClipperLib)throw Error('Planning libraries are unavailable.');
      const union=[];
      if(polys.length){const clip=new ClipperLib.Clipper();clip.AddPaths(polys.map(p=>p.map(v=>({X:Math.round(v.x*SCALE),Y:Math.round(v.y*SCALE)}))),ClipperLib.PolyType.ptSubject,true);clip.Execute(ClipperLib.ClipType.ctUnion,union,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero);}
      // Each outline corner keeps its neighbours, walked with the obstacle on the left. A shortest path only bends at a
      // convex obstacle corner and leaves it along a tangent (the reduced visibility graph), so concave corners (where
      // grown obstacles overlap) are dropped and pairs that cut into an obstacle at either end are never tested.
      const sine=(o,a,b)=>{const ax=a.x-o.x,ay=a.y-o.y,bx=b.x-o.x,by=b.y-o.y,l=Math.hypot(ax,ay)*Math.hypot(bx,by);return l>1e-12?(ax*by-ay*bx)/l:0;};
      const candidates=[];
      for(const ring of union){let pts=ring.map(v=>({x:v.X/SCALE,y:v.Y/SCALE}));
        if(pts.length>=3){let k=0;for(let i=1;i<pts.length;i++)if(dist(pts[i],pts[(i+1)%pts.length])>dist(pts[k],pts[(k+1)%pts.length]))k=i;
          const a=pts[k],b=pts[(k+1)%pts.length],len=dist(a,b),step=Math.min(.01,len/4),probe={x:(a.x+b.x)/2-(b.y-a.y)/len*step,y:(a.y+b.y)/2+(b.x-a.x)/len*step};
          if(!polys.some(poly=>rayInside(probe,poly)))pts=pts.reverse();
          pts.forEach((v,i)=>{const prev=pts[(i+pts.length-1)%pts.length],next=pts[(i+1)%pts.length];candidates.push({x:v.x,y:v.y,prev,next,bend:-sine(v,prev,next)*Math.min(dist(v,prev),dist(v,next))>-TOL});});}
        else candidates.push(...pts);}
      // Where a grown obstacle meets the reachable box (an obstacle against a wall).
      for(const poly of polys)for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];
        for(const x of [bounds.x0,bounds.x1])if(Math.abs(b.x-a.x)>1e-12){const t=(x-a.x)/(b.x-a.x);if(t>=0&&t<=1){const p={x,y:a.y+t*(b.y-a.y)};if(within(p))candidates.push(p);}}
        for(const y of [bounds.y0,bounds.y1])if(Math.abs(b.y-a.y)>1e-12){const t=(y-a.y)/(b.y-a.y);if(t>=0&&t<=1){const p={x:a.x+t*(b.x-a.x),y};if(within(p))candidates.push(p);}}}
      candidates.push({x:bounds.x0,y:bounds.y0},{x:bounds.x1,y:bounds.y0},{x:bounds.x1,y:bounds.y1},{x:bounds.x0,y:bounds.y1});
      // A corner that coincides with a wall point or another outline's corner is kept without the tangent filter.
      const kept=[];for(const p of candidates.filter(p=>within(p)&&!polys.some(poly=>inside(p,poly)))){const same=kept.find(q=>dist(p,q)<.002);if(!same)kept.push({...p});else if(!p.prev||!same.prev||p.prev!==same.prev){same.prev=same.next=null;same.bend=true;}}
      // Concave corners stay in the list (same numbering, so ties between equal routes resolve as before); the tangent
      // test below leaves them almost no edges.
      const vertices=kept;
      // prev and next on the same side of the line (or on it, within rounding): the segment leaves along a tangent.
      const off=(v,w,p)=>sine(v,w,p)*dist(v,p),tangent=(v,w)=>{if(!v.prev)return true;const a=off(v,w,v.prev),b=off(v,w,v.next);return Math.abs(a)<TOL||Math.abs(b)<TOL||a*b>0;};
      // One visibility graph between obstacle vertices; each leg only adds its two endpoints.
      const graph={};for(let i=0;i<vertices.length;i++)graph['v'+i]={};
      for(let i=0;i<vertices.length;i++)for(let j=i+1;j<vertices.length;j++){const length=dist(vertices[i],vertices[j]);if(length>1e-9&&tangent(vertices[i],vertices[j])&&tangent(vertices[j],vertices[i])&&segmentClear(vertices[i],vertices[j],polys)){graph['v'+i]['v'+j]=length;graph['v'+j]['v'+i]=length;}}
      return built={vertices,graph};};
    return s;
  }
  // What happens at a pin (a pause, a turn in place, the action run there) and along the path that
  // leads to it (a regular or an action path, and whether the robot turns or spins while driving it).
  const text=(s,n)=>typeof s==='string'?s.slice(0,n):'';
  const targetOf=t=>t&&finite(t.x)&&finite(t.y)?{x:t.x,y:t.y}:null;
  const bearing=(p,t)=>Math.atan2(t.y-p.y,t.x-p.x)*180/Math.PI;
  // A custom curve: 1-3 Bezier control points between the path's start and its end point, placed by the
  // user like Pedro Pathing's visualizer. The robot drives exactly this curve (it is checked, never moved).
  const controlsOf=c=>{if(!Array.isArray(c))return null;const out=c.filter(q=>q&&finite(q.x)&&finite(q.y)).slice(0,3).map(q=>({x:Math.round(q.x*1000)/1000,y:Math.round(q.y*1000)/1000}));return out.length?out:null;};
  // What the mechanisms do along a path and at its end pin: a list of steps, each an action name, how long it runs
  // (null: until it is done at a pin, the whole path while driving) and the hive cell a Shoot or Aim aims at. At a pin
  // the steps run one after another; while driving they run together from the start of the path. → and + join steps
  // in a route's names, so a step's own name has neither.
  const MAX_STEPS=8;
  const stepOf=s=>{const action=text(s?.action,40).replace(/[→+]/g,' ').replace(/\s+/g,' ').trim();if(!action)return null;
    return {action,seconds:finite(s.seconds)&&s.seconds>0?Math.min(30,+s.seconds.toFixed(3)):null,cell:s.cell==='other'?'other':'start'};};
  const stepsOf=list=>Array.isArray(list)?list.map(stepOf).filter(Boolean).slice(0,MAX_STEPS):[];
  // The one name a route's code runs for its steps: a single step's own name, or every step (with its time and cell)
  // joined by "then" (a pin: one after another) or "+" (a path: together), e.g. "Shoot then Ramp down".
  const aims=s=>/^(shoot|aim)\b/i.test(s.action);
  function stepsName(steps,together=false){if(steps.length<2)return steps[0]?.action||'';
    return steps.map(s=>s.action+(finite(s.seconds)?` ${+s.seconds.toFixed(3)} s`:'')+(s.cell==='other'&&aims(s)?' (other cell)':'')).join(together?' + ':' then ');}
  // The older single action (action, actionSeconds, cell) every runtime reads, from the steps.
  const summaryOf=(steps,together)=>steps.length===1?{action:steps[0].action,actionSeconds:steps[0].seconds,cell:steps[0].cell}:{action:stepsName(steps,together),actionSeconds:null,cell:steps.find(aims)?.cell||'start'};
  // A subject's steps: its own list, or the single action an older save has.
  const stepsFrom=(r,legacy)=>Array.isArray(r.steps)?stepsOf(r.steps):legacy&&text(r.action,40).trim()?stepsOf([{action:r.action,seconds:r.actionSeconds,cell:r.cell}]):[];
  function pathEffects(raw){const r=raw&&typeof raw==='object'?raw:{},rotate=['turn','spin','relative','start','track','tangent','reverse'].includes(r.rotate)?r.rotate:'keep';
    // An action path runs its steps while it is driven. An older action path with no action name stays one.
    const steps=stepsFrom(r,r.kind==='action'),kind=steps.length||r.kind==='action'&&!Array.isArray(r.steps)?'action':'regular';
    return {controls:controlsOf(r.controls),kind,steps,...summaryOf(steps,true),note:text(r.note,160),style:['sharp','spline'].includes(r.style)?r.style:null,shapeAuto:r.shapeAuto===true,rotate,heading:finite(r.heading)?norm(r.heading):0,angle:finite(r.angle)?Math.max(-36000,Math.min(36000,r.angle)):90,target:targetOf(r.target),spins:finite(r.spins)?Math.max(-100,Math.min(100,Math.round(r.spins)||1)):1,power:finite(r.power)?Math.max(0,Math.min(1,r.power)):null};}
  // At a pin the robot pauses for `wait`, then runs its steps in order, then drives on. Older routes ran an intake
  // for the pin's pause: that becomes the intake's own time.
  function pinEffects(p){
    if(p.actionSeconds===undefined&&!Array.isArray(p.steps)&&/^\s*intake\s*$/i.test(String(p.action||''))&&finite(p.wait)&&p.wait>0)p={...p,actionSeconds:p.wait,wait:0};
    const steps=stepsFrom(p,true);
    return {wait:finite(p.wait)?Math.max(0,p.wait):0,steps,...summaryOf(steps,false),note:text(p.note,160),turn:finite(p.turn)?(p.turnMode==='relative'?p.turn:norm(p.turn)):null,turnMode:['relative','start','track'].includes(p.turnMode)?p.turnMode:'absolute',target:targetOf(p.target),path:pathEffects(p.path)};}
  function pathEnd(path,heading,start,point){return path.rotate==='relative'?heading+path.angle:path.rotate==='start'?start:path.rotate==='track'&&path.target?bearing(point,path.target):path.rotate==='turn'?path.heading:heading;}
  function pinHeading(p,heading,start){return p.turn===null||!finite(p.turn)?null:p.turnMode==='relative'?norm(heading+p.turn):p.turnMode==='start'?norm(start):p.turnMode==='track'&&p.target?bearing(p,p.target):norm(p.turn);}
  // Shared by clearance checks and preview; target bearings follow the actual Bezier point.
  // Direction of travel along a Bezier curve, degrees: the last de Casteljau step (a numeric step where the curve stalls).
  function tangentAt(points,t){let p=points.map(q=>({x:q.x,y:q.y}));while(p.length>2)p=p.slice(1).map((q,i)=>({x:p[i].x+(q.x-p[i].x)*t,y:p[i].y+(q.y-p[i].y)*t}));let dx=p[1].x-p[0].x,dy=p[1].y-p[0].y;
    if(Math.hypot(dx,dy)<1e-9){const a=bezier(points,Math.max(0,t-1e-3)),b=bezier(points,Math.min(1,t+1e-3));dx=b.x-a.x;dy=b.y-a.y;}return Math.atan2(dy,dx)*180/Math.PI;}
  // Tangent segments face along the path (reverse: backwards along it), like Pedro Pathing's tangent heading.
  function headingAt(s,t){return s.tangent?tangentAt(s.points,t)+(s.reverse?180:0):s.target?bearing(bezier(s.points,t),s.target):finite(s.endHeading)?s.heading+(s.endHeading-s.heading)*t:s.heading;}
  function pathDescription(raw,power=.8){const p=pathEffects(raw),bits=[`${Math.round((p.power??power)*100)}% motor power${p.power===null?' (setup)':''}`];
    if(p.kind==='action')bits.push(`${p.action||'Action'} while driving${finite(p.actionSeconds)?` for the first ${p.actionSeconds} s`:''}`);
    bits.push(p.rotate==='tangent'?'Face along the path (tangent)':p.rotate==='reverse'?'Face backwards along the path':p.rotate==='relative'?`Turn by ${p.angle>=0?'+':''}${p.angle}°`:p.rotate==='turn'?`Face field heading ${p.heading}°`:p.rotate==='spin'?`Spin ${Math.abs(p.spins)} ${p.spins<0?'clockwise':'counterclockwise'}`:p.rotate==='start'?'Return to starting heading':p.rotate==='track'?`Track target ${p.target?`(${p.target.x}, ${p.target.y}) in`:'not selected'}`:'Hold inherited heading');
    if(p.controls)bits.push(`Custom curve (${p.controls.length} handle${p.controls.length>1?'s':''})`);else if(p.style)bits.push(p.style==='spline'?'Smooth spline':'Straight segments');if(p.note)bits.push(p.note);return bits;}
  function pathAppearance(raw,power=.8){const p=pathEffects(raw),key=p.rotate==='track'?'track':p.rotate!=='keep'?'rotation':p.power!==null?'power':p.kind==='action'?'action':'normal';return {key,color:{track:'#49cbb3',rotation:'#b79bff',power:'#f2bc62',action:'#63c5ff',normal:'#aeb8c5'}[key],action:p.kind==='action',power:p.power??power};}
  // About how long a pin's steps hold the robot, for the preview: each step's own time, else 1.5 s for a Shoot and 1 s for others.
  const stepsSeconds=stop=>(stop.steps?.length?stop.steps:[{action:stop.action,seconds:stop.actionSeconds}]).reduce((t,s)=>t+(finite(s.seconds)?s.seconds:/^\s*shoot/i.test(s.action)?1.5:1),0);
  const stopOf=p=>({x:p.x,y:p.y,wait:p.wait,action:p.action,actionSeconds:p.actionSeconds,cell:p.cell,steps:p.steps,note:p.note,turn:p.turn,path:p.path});
  const rotates=(path,heading)=>!!path&&(path.rotate==='spin'||['relative','start','track','tangent','reverse'].includes(path.rotate)||path.rotate==='turn'&&finite(path.heading)&&Math.abs(norm(path.heading-heading))>1e-6);
  const effectful=project=>Array.isArray(project?.pins)&&project.pins.some(p=>finite(p?.turn)||p?.path?.style||!project.nonholonomic&&(['turn','spin','relative','start','track','tangent','reverse'].includes(p?.path?.rotate)||controlsOf(p?.path?.controls)));
  // Each segment records which pin it leads to, so paths can be told apart (action or regular).
  // Poses along a planned route for a quick look without physics. Segments are sampled about every inch; where
  // the robot turns on the spot (a segment that starts facing another way, or a pin's turn) the turn is spread over
  // steps of at most 5 degrees. d is inches driven; s is how far a scrubber moves: d plus, for each turn on the spot,
  // the distance the robot's corner sweeps, so turns get visible time. Headings stay continuous, so spins add up.
  // At a pin that pauses or runs an action the robot stands still for a while (PREVIEW_SPEED s per second, at most
  // 2.5 s each): those poses carry the action (and its cell) and act, its progress 0..1 ('' for a pause). Poses on
  // an action path carry the action without act: it runs while driving.
  const PREVIEW_SPEED=30;
  function previewPoses(route,footprint,start={}){
    const out=[],segments=route?.segments||[],stops=route?.stops||[];if(!segments.length)return out;
    const corner=footprint?Math.hypot(Math.max(footprint.front,footprint.rear),footprint.half):9;let s=0,d=0;
    const push=p=>out.push({...p,s,d});
    const turnTo=(heading,path)=>{const last=out.at(-1),turn=norm(heading-last.heading);if(Math.abs(turn)<.5)return;const n=Math.ceil(Math.abs(turn)/5);
      for(let j=1;j<=n;j++){s+=Math.abs(turn)/n*Math.PI/180*corner;push({x:last.x,y:last.y,heading:last.heading+turn*j/n,path,turning:true});}};
    const dwell=(seconds,action,cell,path)=>{const last=out.at(-1),n=12,step=Math.min(2.5,seconds)*PREVIEW_SPEED/n;
      for(let j=0;j<=n;j++){if(j)s+=step;push({x:last.x,y:last.y,heading:last.heading,path,action,cell,act:j/n});}};
    const first=segments[0].points[0];push({x:first.x,y:first.y,heading:[start.heading,segments[0].heading,route.heading].find(finite)??0,path:segments[0].to??0});
    segments.forEach((seg,i)=>{
      const path=seg.to??0,headingOf=t=>{const h=headingAt(seg,t);return finite(h)?h:null;},wraps=seg.tangent||!!seg.target;
      // While driving, a path's steps run together: the preview acts out the one there is most to see of (an intake
      // pulling pieces in, then a shot, aiming, spinning up), and names it.
      const together=stops[path]?.path?.kind==='action'&&stops[path].path.action?stops[path].path:null,shown=together&&Array.isArray(together.steps)&&together.steps.length?[/^intake$/i,/^shoot\b/i,/^aim$/i,/^spin\s*up$/i].map(re=>together.steps.find(x=>re.test(String(x.action||'').trim()))).find(Boolean)||together.steps[0]:null;
      const moving=together?{action:shown?shown.action:together.action,cell:shown?.cell||together.cell}:{};
      let length=0;for(let k=1;k<seg.points.length;k++)length+=dist(seg.points[k],seg.points[k-1]);
      const sweep=finite(seg.endHeading)&&finite(seg.heading)?Math.abs(seg.endHeading-seg.heading):0,n=Math.min(2000,Math.max(4,Math.ceil(length),Math.ceil(sweep/5)));
      let prev=headingOf(0);if(prev!==null)turnTo(prev,path);
      for(let j=1;j<=n;j++){const t=j/n,p=bezier(seg.points,t),h=headingOf(t),last=out.at(-1),step=Math.hypot(p.x-last.x,p.y-last.y);s+=step;d+=step;
        push({x:p.x,y:p.y,heading:h===null||prev===null?last.heading:last.heading+(wraps?norm(h-prev):h-prev),path,...moving});prev=h;}
      for(const stop of stops)if(stop.segment===i){if(finite(stop.turn))turnTo(stop.turn,path);if(stop.wait>0)dwell(stop.wait,'','start',path);
        // At a pin the steps run one after another, so the preview acts out each in turn (1.2 s for one with no time of its own).
        if(stop.action){const list=Array.isArray(stop.steps)&&stop.steps.length>1?stop.steps:null;
          if(list)for(const x of list)dwell(finite(x.seconds)?x.seconds:1.2,x.action,x.cell||stop.cell,path);else dwell(stepsSeconds(stop),Array.isArray(stop.steps)&&stop.steps.length===1?stop.steps[0].action:stop.action,stop.cell,path);}}
    });
    return out;
  }
  function annotate(route){const stops=route.stops||[];let k=0;route.segments.forEach((s,i)=>{while(k<stops.length-1&&stops[k].segment<i)k++;s.to=k;});return route;}
  // Inspect every endpoint even when another pin (or the start) prevents planning. Path checks
  // are optional so the UI can refresh clearance immediately while a worker plans the route.
  function analyze(project,rawFootprint,fieldZones=[],rawField,paths=false){
    const issues=[],fp=footprintOf(rawFootprint),f=fieldOf(rawField),all=[...(project.zones||[]),...fieldZones].map(validateZone),pins=project.pins||[];
    const add=(pin,code,message)=>{if(!issues.some(q=>q.pin===pin&&q.code===code))issues.push({pin,code,message});};
    let heading=project.start?.heading||0;
    if(!project.start||!safePose(project.start,all,fp,f))add(null,'start','Starting pose overlaps a wall or obstacle. Drag the robot to a clear position.');
    pins.forEach((raw,i)=>{const p={...raw,...pinEffects(raw)},path=p.path,endHeading=project.nonholonomic?heading:pathEnd(path,heading,project.start?.heading||0,p),turn=pinHeading(p,endHeading,project.start?.heading||0);
      if(path.rotate==='track'&&!path.target)add(i,'target',`Path to pin ${i+1}: choose a target point to track.`);
      if(p.turnMode==='track'&&finite(p.turn)&&(!p.target||dist(p,p.target)<.25))add(i,'target',`Pin ${i+1}: choose a target away from this pin.`);
      const headings=['tangent','reverse'].includes(path.rotate)?[heading,...Array.from({length:24},(_,j)=>j*15)]:project.rotate===false||path.rotate!=='keep'?[endHeading]:[heading,...Array.from({length:24},(_,j)=>j*15)];
      if(!headings.some(h=>safePose({...p,heading:h},all,fp,f)))add(i,'clearance',`Pin ${i+1}: the whole chassis does not fit here. Move this pin away from the wall or obstacle, or move the obstacle.`);
      if(finite(turn)&&Math.abs(norm(turn-endHeading))>1e-6&&!turnClear(p,endHeading,turn,all,fp,f,Math.max(MIN_CLEARANCE,project.clearance||1)))add(i,'turn',`Pin ${i+1}: the requested turn sweeps into a wall or obstacle. Move the pin into open space or remove its turn.`);
      if(paths&&!issues.some(q=>q.pin===i)&&!(i===0&&issues.some(q=>q.code==='start'))&&!(i>0&&issues.some(q=>q.pin===i-1))){
        const from=i?pins[i-1]:project.start;
        try{plan({...project,start:{...from,heading},pins:[p]},fp,fieldZones,f);}
        catch(e){add(i,'path',e.message.replace(/pin 1\b/gi,`pin ${i+1}`));}
      }
      heading=finite(turn)?turn:endHeading;
    });
    return issues;
  }
  function plan(project,rawFootprint,fieldZones=[],rawField){
    const route=annotate(effectful(project)?planEffects(project,rawFootprint,fieldZones,rawField):planBasic(project,rawFootprint,fieldZones,rawField));if(finite(project.defaultPower))route.defaultPower=Math.max(0,Math.min(1,project.defaultPower));return route;
  }
  // Route problems physics can show rather than the planner refuse: an end point the robot does not fit at, a turn that
  // sweeps into something, no clear way round. The rest (the start overlapping something, a target to choose) still stop it.
  const PHYSICS_ISSUES=['clearance','turn','path'];
  // A route the planner cannot keep clear of every wall and obstacle still runs, on physics (the user's call of
  // 2026-11-17): each stretch it can route is routed as usual, and each path it cannot is driven as drawn, straight or
  // along its curve, avoiding nothing, so Run shows the robot meeting whatever is in the way. route.unclear lists those
  // paths ({pin, code, message}) for Path planning to draw yellow. issues: analyze(project, …, true) when already known.
  function planLoose(project,rawFootprint,fieldZones=[],rawField,issues){
    const fp=footprintOf(rawFootprint),field=fieldOf(rawField),raw=Array.isArray(project?.pins)?project.pins:[];
    if(!Array.isArray(issues))issues=analyze(project,fp,fieldZones,field,true);
    const hard=issues.find(q=>!PHYSICS_ISSUES.includes(q.code));if(hard)throw Error(hard.message);
    // An open field, the walls a robot's reach away, where nothing is in the way: a path driven as drawn is planned there.
    const r=reach(fp)+1,open={x0:field.x0-r,y0:field.y0-r,x1:field.x1+r,y1:field.y1+r};
    const {pins}=prepare({...project,zones:[]},fp,[],open);
    // A path is driven as drawn when its own end point has a problem, or it starts where the robot does not fit.
    const why=new Map(),mark=(i,q)=>{if(i<pins.length&&!why.has(i))why.set(i,q);};
    for(const q of issues)if(Number.isInteger(q.pin)){mark(q.pin,q);if(q.code==='clearance')mark(q.pin+1,{code:'after',message:`Path to pin ${q.pin+2} starts where the robot does not fit (pin ${q.pin+1}).`});}
    const routed=(from,list)=>plan({...project,start:from,pins:list},fp,fieldZones,field),drawn=(from,pin)=>plan({...project,zones:[],clearance:MIN_CLEARANCE,start:from,pins:[pin]},fp,[],open);
    const endOf=(route,from)=>{const s=route.segments.at(-1),stop=route.stops?.at(-1);if(!s)return from;const p=s.points.at(-1),h=finite(stop?.turn)?stop.turn:finite(s.endHeading)?s.endHeading:finite(s.heading)?s.heading:route.heading;return {x:p.x,y:p.y,heading:finite(h)?h:from.heading};};
    const parts=[],unclear=[];let at={x:project.start.x,y:project.start.y,heading:project.start.heading};
    // One pin at a time: routed if it can be, else driven as drawn. A pin on the spot the robot is already at only stops there.
    const one=i=>{const pin=raw[i];if(dist(at,pins[i])<.01){parts.push({stop:stopOf(pins[i])});return;}
      let route=null,issue=why.get(i);if(!issue)try{route=routed(at,[pin]);}catch(e){issue={code:'path',message:e.message.replace(/pin 1\b/gi,`pin ${i+1}`)};}
      if(!route){route=drawn(at,pin);unclear.push({pin:i,code:issue.code,message:issue.message});}
      parts.push({route});at=endOf(route,at);};
    // Clear stretches are routed together, so their curves flow through the pins between them.
    for(let i=0;i<pins.length;){
      if(why.has(i)){one(i);i++;continue;}
      let j=i;while(j+1<pins.length&&!why.has(j+1))j++;
      let route=null;if(j>i)try{route=routed(at,raw.slice(i,j+1));}catch{}
      if(route){parts.push({route});at=endOf(route,at);}else for(let k=i;k<=j;k++)one(k);
      i=j+1;}
    const segments=[],samples=[],stops=[];let length=0,turnDegrees=0;
    for(const part of parts){
      if(part.stop){stops.push({...part.stop,segment:Math.max(0,segments.length-1)});continue;}
      const route=part.route,base=segments.length;
      for(const s of route.segments){const {to,...rest}=s;segments.push({...rest,heading:finite(s.heading)?s.heading:route.heading});}
      for(const p of route.samples){if(samples.length&&dist(samples.at(-1),p)<1e-9)continue;samples.push({x:p.x,y:p.y});}
      for(const s of route.stops)stops.push({...s,segment:s.segment+base});
      length+=route.length;turnDegrees+=route.turnDegrees||0;}
    if(!segments.length)throw Error('Place a pin away from the starting position.');
    // Every path carries its own heading, and the simulator drives these as they are (effects: it does not re-check them).
    const route=annotate({style:['sharp','rounded','spline'].includes(project.style)?project.style:'sharp',segments,samples,length,heading:project.start.heading,clearance:Math.max(MIN_CLEARANCE,finite(project.clearance)?project.clearance:1),footprint:fp,field,vertices:[project.start,...pins],pins:pins.length,stops,turns:true,turnDegrees,effects:true,...(project.nonholonomic?{nonholonomic:true}:{}),unclear});
    if(finite(project.defaultPower))route.defaultPower=Math.max(0,Math.min(1,project.defaultPower));return route;
  }
  // Exhaustive for up to four unlocked paths; bounded alternatives for longer routes.
  // Manually assigned shapes stay fixed. Optimizer assignments remain eligible next time.
  function shapeCandidates(project,seed){
    const free=project.pins.map((p,i)=>(!p.path?.style||p.path.shapeAuto)&&!controlsOf(p.path?.controls)?i:-1).filter(i=>i>=0),base=project.pins.map(p=>p.path?.style||(['sharp','spline'].includes(project.style)?project.style:'sharp'));
    const out=[],seen=new Set(),add=styles=>{const key=styles.join(',');if(seen.has(key))return;seen.add(key);const pins=project.pins.map((p,i)=>({...p,path:{...pathEffects(p.path),style:styles[i],shapeAuto:free.includes(i)}}));out.push({styles,project:{...project,pins},label:styles.every(s=>s===styles[0])?(styles[0]==='sharp'?'All straight':'All splines'):`Mixed · ${styles.filter(s=>s==='sharp').length} straight / ${styles.filter(s=>s==='spline').length} spline`});};
    if(seed){add([...seed]);for(const i of free){const next=[...seed];next[i]=next[i]==='sharp'?'spline':'sharp';add(next);}return out;}
    if(free.length<=4){for(let mask=0;mask<2**free.length;mask++){const styles=[...base];free.forEach((i,j)=>styles[i]=mask&(1<<j)?'spline':'sharp');add(styles);}}
    else{add(base);for(const type of ['sharp','spline']){const styles=[...base];free.forEach(i=>styles[i]=type);add(styles);}for(const parity of [0,1]){const styles=[...base];free.forEach((i,j)=>styles[i]=(j+parity)%2?'spline':'sharp');add(styles);}for(const i of free.slice(0,12)){const styles=[...base];styles[i]=styles[i]==='sharp'?'spline':'sharp';add(styles);}}
    return out;
  }
  // Holonomic robots may turn in place to fit past obstacles; tank-style robots drive along their heading.
  function planBasic(project,rawFootprint,fieldZones=[],rawField){
    if(project?.nonholonomic)return planTank(project,rawFootprint,fieldZones,rawField);
    let fixed=null,failure=null;try{fixed=planFixed(project,rawFootprint,fieldZones,rawField);}catch(e){failure=e;}
    if(project?.rotate===false||!fixed&&!/route|clearance|block/i.test(failure?.message||'')){if(fixed)return fixed;throw failure;}
    // Only search turning routes when the fixed-heading route is missing or detours noticeably.
    let direct=0,at=project.start;for(const p of project.pins){direct+=dist(at,p);at=p;}
    if(fixed&&fixed.length<=direct*1.08+2)return fixed;
    let turning=null;try{turning=planTurning(project,rawFootprint,fieldZones,rawField);}catch(e){if(!fixed)throw failure;}
    if(turning&&turning.turnDegrees>0&&(!fixed||turning.cost<fixed.length-1))return turning;
    if(fixed)return fixed;throw failure;
  }
  // Pins that turn the robot in place, and paths it turns or spins along, split the route into
  // pieces planned one after another, each starting at the heading the previous one ends with.
  // A path the robot rotates along is planned for a square that encloses the footprint's whole
  // rotation circle, so it clears obstacles at every heading on the way. Tank drivetrains only
  // turn at pins: they cannot rotate while driving sideways.
  function planEffects(project,rawFootprint,fieldZones=[],rawField){
    const {footprint,field,start,all,pins,clearance}=prepare(project,rawFootprint,fieldZones,rawField),tank=!!project.nonholonomic,mixed=pins.some(p=>p.path.style),styleOf=p=>p.path.style||project.style;
    const plain=p=>({...p,turn:null,path:{...p.path,rotate:'keep'}}),endOf=s=>finite(s.endHeading)?s.endHeading:s.heading;
    const segments=[],samples=[];let at={x:start.x,y:start.y,heading:start.heading},chunk=[],base=0,length=0,turnDegrees=0;
    // Rotation modifiers split planning at pins, but must not discard the neighbouring spline
    // tangents. Try that curve first, then the safe straight/detour geometry if its sweep fails.
    const shaped=(r,i)=>{if(styleOf(pins[i])!=='spline'||r.segments.length!==1||r.segments[0].type!=='line')return r;
      const [a,b]=r.segments[0].points,prev=i>0?(i>1?pins[i-2]:start):null,next=pins[i+1],tension=finite(project.tension)?Math.max(0,Math.min(1,project.tension)):.75;
      const tangent=(a,p,b)=>{if(!a||!b)return null;const ux=p.x-a.x,uy=p.y-a.y,vx=b.x-p.x,vy=b.y-p.y,u=Math.hypot(ux,uy),v=Math.hypot(vx,vy),dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(!u||!v||!d||(ux*vx+uy*vy)/(u*v)<Math.cos(150*Math.PI/180))return null;const m=tension*Math.min(u,v)/3;return {x:dx/d*m,y:dy/d*m};};
      const before=i&&!(pins[i-1].wait>0||pins[i-1].action||finite(pins[i-1].turn))?tangent(prev,a,b):null,after=!(pins[i].wait>0||pins[i].action||finite(pins[i].turn))?tangent(a,b,next):null;
      if(!before&&!after)return r;const c1=before?{x:a.x+before.x,y:a.y+before.y}:{x:a.x+(b.x-a.x)/3,y:a.y+(b.y-a.y)/3},c2=after?{x:b.x-after.x,y:b.y-after.y}:{x:b.x-(b.x-a.x)/3,y:b.y-(b.y-a.y)/3},points=[a,c1,c2,b],samples=Array.from({length:65},(_,j)=>bezier(points,j/64)),length=samples.slice(1).reduce((n,p,j)=>n+dist(p,samples[j]),0);
      return {...r,segments:[{...r.segments[0],type:'curve',points}],samples,length};};
    const add=(route,fallback)=>{for(const s of route.segments)segments.push({...s,heading:finite(s.heading)?s.heading:fallback});
      for(const p of route.samples){if(samples.length&&dist(samples.at(-1),p)<1e-9)continue;samples.push({x:p.x,y:p.y});}
      length+=route.length;turnDegrees+=route.turnDegrees||0;const last=segments.at(-1);if(last)at={...last.points.at(-1),heading:norm(endOf(last))};};
    // Errors from a piece number its pins from 1; renumber them for the whole route.
    const renumber=(e,offset)=>Error(/starting footprint/i.test(e.message)?`Pin ${offset} has no room for the robot at ${Math.round(at.heading)}°. Move it away from obstacles and walls.`:e.message.replace(/pin (\d+)/gi,(m,d)=>m.replace(d,String(+d+offset))));
    const flush=()=>{const now=chunk;chunk=[];if(!now.length||now.every(p=>dist(p,at)<.01))return;
      let r;try{r=planBasic({...project,rotate:tank?project.rotate:false,start:at,pins:now.map(plain)},footprint,fieldZones,field);}catch(e){throw renumber(e,base);}add(r,at.heading);};
    pins.forEach((p,i)=>{
      if(!tank&&(mixed||rotates(p.path,at.heading)||p.path.controls)){flush();
        const radius=reach(footprint)+.05,square={front:radius,rear:radius,half:radius},spin=p.path.rotate==='spin';
        // Try the actual heading interpolation first. A full rotation envelope at the start
        // incorrectly rejects a robot that safely drives away from a wall as it turns.
        const tracking=p.path.rotate==='track',along=['tangent','reverse'].includes(p.path.rotate),flip=p.path.rotate==='reverse'?180:0;if(tracking&&!p.path.target)throw Error(`Path to pin ${i+1}: choose a target point to track.`);
        const h0=tracking?bearing(at,p.path.target):at.heading,h1=spin?h0+360*p.path.spins:p.path.rotate==='relative'?h0+p.path.angle:h0+norm(pathEnd(p.path,h0,start.heading,p)-h0);
        if(tracking&&(!turnClear(at,at.heading,h0,all,footprint,field,clearance)||dist(at,p.path.target)<.25))throw Error(`Path to pin ${i+1}: no room to face the target at the path's start. Move the start or target.`);
        // Facing along the path: each segment's heading follows its own tangent; the robot turns in place where the
        // path starts facing another way, and at any corner between segments.
        const alongRoute=r=>{let last=at.heading;return {...r,segments:r.segments.map(s=>{const h=last+norm(tangentAt(s.points,0)+flip-last),e=h+norm(tangentAt(s.points,1)+flip-h);last=e;return {...s,tangent:true,...(flip?{reverse:true}:{}),heading:h,endHeading:e};})};};
        const rotateRoute=r=>{if(along)return alongRoute(r);const lengths=r.segments.map(s=>Array.from({length:32},(_,j)=>dist(bezier(s.points,j/32),bezier(s.points,(j+1)/32))).reduce((a,b)=>a+b,0)),total=lengths.reduce((a,b)=>a+b,0)||1;let done=0;
          return {...r,segments:r.segments.map((s,j)=>{const a=h0+(h1-h0)*done/total;done+=lengths[j];return tracking?{...s,target:{...p.path.target},heading:bearing(s.points[0],p.path.target),endHeading:bearing(s.points.at(-1),p.path.target)}:{...s,heading:a,endHeading:h0+(h1-h0)*done/total};})};};
        const check=r=>{
          if(along){let h=at.heading;for(const s of r.segments){if(Math.abs(norm(s.heading-h))>.5&&!turnClear(s.points[0],h,s.heading,all,footprint,field,clearance))throw Error('Turning sweep blocked.');h=s.endHeading;}}
          const padded={front:footprint.front+clearance/2,rear:footprint.rear+clearance/2,half:footprint.half+clearance/2};
          for(const s of r.segments){let prev={...s.points[0],heading:s.heading};const polyLength=s.points.slice(1).reduce((n,q,j)=>n+dist(q,s.points[j]),0),count=Math.max(64,Math.ceil(Math.abs(s.endHeading-s.heading)/2),Math.ceil(polyLength*(tracking?4:2)));
            for(let j=1;j<=count;j++){const pose={...bezier(s.points,j/count),heading:headingAt(s,j/count)};
              if(tracking){const dx=pose.x-prev.x,dy=pose.y-prev.y,t=Math.max(0,Math.min(1,((s.target.x-prev.x)*dx+(s.target.y-prev.y)*dy)/(dx*dx+dy*dy||1)));if(dist({x:prev.x+t*dx,y:prev.y+t*dy},s.target)<.25)throw Error('Target lies on the driving path. Move the target away from the route.');}
              if(!safeSweep(prev,pose,all,footprint,field)||all.some(z=>zoneHits(body(pose,padded),z)))throw Error('Turning sweep blocked.');prev=pose;}}
          return r;};
        // A custom curve is driven as drawn: it is only checked, never re-routed.
        const custom=p.path.controls?(()=>{const points=[{x:at.x,y:at.y},...p.path.controls.map(c=>({x:c.x,y:c.y})),{x:p.x,y:p.y}],samples=Array.from({length:65},(_,j)=>bezier(points,j/64));return {segments:[{type:'curve',points,custom:true}],samples,length:samples.slice(1).reduce((n,q,j)=>n+dist(q,samples[j]),0)};})():null;
        const attempt=fp=>{if(custom)return check(rotateRoute(custom));const baseRoute=planBasic({...project,style:styleOf(p),start:{...at,heading:h0},pins:[plain(p)],rotate:false},fp,fieldZones,field);try{return check(rotateRoute(shaped(baseRoute,i)));}catch{return check(rotateRoute(baseRoute));}};
        let r;try{r=attempt(footprint);
        }catch(first){if(custom)throw Error(/Target lies/.test(first.message)?`Path to pin ${i+1}: target lies on the driving path. Move the target away from the route.`:`Path to pin ${i+1}: the custom curve takes the robot into a wall, obstacle or the field edge. Drag its handles into open space, or set the path's shape back to automatic.`);
          try{r=attempt(square);}
        catch(last){if(/Target lies/.test(first.message)||/Target lies/.test(last.message))throw Error(`Path to pin ${i+1}: target lies on the driving path. Move the target away from the route.`);throw Error(`The path to pin ${i+1} has no room to ${spin?'spin':'turn'} while driving: the turning robot needs ${(2*radius).toFixed(0)} in of clear width. Move pin ${i+1} or the path's start away from obstacles and walls, or turn at a pin instead.`);}
        }
        add({...r,turnDegrees:along?r.segments.reduce((n,s,j)=>n+Math.abs(s.endHeading-s.heading)+Math.abs(norm(s.heading-(j?r.segments[j-1].endHeading:at.heading))),0):Math.abs(h1-h0)},h0);
      }else{if(!chunk.length)base=i;chunk.push(p);}
      if(finite(p.turn)){flush();if(p.turnMode==='track'&&(!p.target||dist(p,p.target)<.25))throw Error(`Pin ${i+1}: choose a target away from this pin.`);p.turn=pinHeading(p,at.heading,start.heading);p.turnMode='absolute';const delta=norm(p.turn-at.heading);
        if(Math.abs(delta)>1e-6){if(!turnClear(at,at.heading,p.turn,all,footprint,field,clearance))throw Error(`Pin ${i+1} has no room to turn the robot to ${Math.round(p.turn)}°. Move it away from obstacles and walls.`);turnDegrees+=Math.abs(delta);at={...at,heading:norm(p.turn)};}}
    });
    flush();
    if(!segments.length)throw Error('Place a pin away from the starting position.');
    const route={style:['sharp','rounded','spline'].includes(project.style)?project.style:'sharp',segments,samples,length,heading:start.heading,clearance,footprint,field,vertices:[start,...pins],pins:pins.length,stops:stopsOf(segments,pins),turns:true,turnDegrees,effects:true};
    if(tank)route.nonholonomic=true;
    return route;
  }
  function planTank(project,rawFootprint,fieldZones,rawField){
    {
      const request={...project,nonholonomic:false,rotate:false,style:'sharp'},all=(project.zones||[]).concat(fieldZones),fp=footprintOf(rawFootprint),bounds=fieldOf(rawField);
      try{return tankRoute(planBasic(request,fp,fieldZones,bounds),all,fp,bounds);}catch(first){
        // A square enclosing the rotation circle makes obstacle detours safe at any heading.
        const radius=Math.hypot(Math.max(fp.front,fp.rear),fp.half)+.1;
        try{return tankRoute(planBasic(request,{front:radius,rear:radius,half:radius},fieldZones,bounds),all,fp,bounds);}catch{
          // No direct conversion works: search drive, reverse and turn-in-place moves instead.
          try{return planTankLattice(project,rawFootprint,fieldZones,rawField);}catch(lattice){throw Error('Tank route needs room to turn the whole chassis. Move the start or pins farther from obstacles and walls. '+(lattice.message||first.message));}}
      }
    }
  }
  // The original planner: the robot keeps its starting heading for the whole route.
  function planFixed(project,rawFootprint,fieldZones=[],rawField){
    const {footprint,field,start,all,pins,clearance}=prepare(project,rawFootprint,fieldZones,rawField),heading=start.heading;
    const s=space(all,footprint,field,heading,clearance),{polys,within}=s,smoothPolys=inflated(all,footprint,heading,clearance/2);
    for(const p of smoothPolys)p.box=boxOf(p);
    const {dijkstra}=libs();if(!dijkstra)throw Error('Planning libraries are unavailable.');
    // One visibility graph between obstacle vertices; each leg only adds its two endpoints.
    const {vertices,graph}=s.visibility();
    const route=[{x:start.x,y:start.y,pin:true}];let cursor=start;
    for(let leg=0;leg<pins.length;leg++){
      const goal=pins[leg];if(!within(goal)||polys.some(poly=>inside(goal,poly)))throw Error(`Pin ${leg+1} leaves insufficient robot clearance. Move it away from the barrier, field element or wall.`);
      if(dist(cursor,goal)<.01){cursor=goal;continue;}
      const local={...graph,s:{},g:{}};const link=(key,p)=>{for(let i=0;i<vertices.length;i++){const length=dist(p,vertices[i]);if(segmentClear(p,vertices[i],polys)){local[key]['v'+i]=length;local['v'+i]={...local['v'+i],[key]:length};}}};
      for(let i=0;i<vertices.length;i++)local['v'+i]=graph['v'+i];link('s',cursor);link('g',goal);
      if(segmentClear(cursor,goal,polys)){local.s.g=dist(cursor,goal);local.g.s=local.s.g;}
      let keys;try{keys=dijkstra.find_path(local,'s','g');}catch{throw Error(`No safe route to pin ${leg+1}. The barriers block the robot's footprint.`);}
      route.push(...keys.slice(1).map(k=>k==='g'?{...goal}:{...vertices[Number(k.slice(1))],pin:false}));cursor=goal;
    }
    if(route.length<2)throw Error('Place a pin away from the starting position.');
    const style=['sharp','rounded','spline'].includes(project.style)?project.style:project.smooth===false?'sharp':'rounded';
    const pt=p=>({x:p.x,y:p.y}),curveClear=points=>{const c=Array.from({length:41},(_,j)=>bezier(points,j/40));return c.every(within)&&c.every((v,j)=>!j||segmentClear(c[j-1],v,smoothPolys));};
    let segments=[];
    if(style==='spline'){
      // Cubic curves through every waypoint and obstacle corner, tangent-continuous where the robot
      // passes through. The start, the end and pins with a pause are full stops. Where a curve would
      // come closer than half the clearance, the tension at its two corners halves (to a straight line).
      const tension=finite(project.tension)?clamp(project.tension,0,1.5):1,n=route.length;
      // Full stops: the ends, pins with a pause, and places where the route doubles back (a
      // reversal cannot be taken at speed, and its tangent would be zero).
      const turn=i=>{const a=route[i-1],p=route[i],b=route[i+1],ux=p.x-a.x,uy=p.y-a.y,vx=b.x-p.x,vy=b.y-p.y,lu=Math.hypot(ux,uy),lv=Math.hypot(vx,vy);return lu<1e-6||lv<1e-6?Math.PI:Math.acos(Math.max(-1,Math.min(1,(ux*vx+uy*vy)/(lu*lv))));};
      const k=route.map((p,i)=>i===0||i===n-1||(p.pin&&p.wait>0)||turn(i)>150*Math.PI/180?0:tension);
      for(let attempt=0;attempt<12;attempt++){
        const tangent=route.map((p,i)=>{if(!k[i])return null;const a=route[i-1],b=route[i+1],dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),m=k[i]*Math.min(dist(a,p),dist(p,b))/3;return l<1e-6||m<.05?null:{x:dx/l*m,y:dy/l*m};});
        segments=[];let failed=false;
        for(let i=0;i<n-1;i++){
          const a=route[i],b=route[i+1];if(dist(a,b)<1e-6)continue;
          if(!tangent[i]&&!tangent[i+1]){segments.push({type:'line',points:[pt(a),pt(b)]});continue;}
          const c1=tangent[i]?{x:a.x+tangent[i].x,y:a.y+tangent[i].y}:{x:a.x+(b.x-a.x)/3,y:a.y+(b.y-a.y)/3},c2=tangent[i+1]?{x:b.x-tangent[i+1].x,y:b.y-tangent[i+1].y}:{x:b.x-(b.x-a.x)/3,y:b.y-(b.y-a.y)/3};
          const points=[pt(a),c1,c2,pt(b)];
          if(curveClear(points))segments.push({type:'curve',points});else{failed=true;for(const j of [i,i+1])k[j]=k[j]*.5<.05?0:k[j]*.5;}
        }
        if(!failed)break;
      }
    }else{
      // Round interior corners with a tangent quadratic Bezier (G1 continuous). A rounded
      // corner may use at most half of the clearance buffer; otherwise it stays sharp.
      let at=route[0];
      for(let i=1;i<route.length;i++){
        const p=route[i],next=route[i+1];let rounded=false;
        if(style==='rounded'&&!p.pin&&next&&dist(at,p)>1e-6&&dist(p,next)>1e-6){
          for(const limit of [6,3,1.5]){const trim=Math.min(limit,dist(at,p)/2.5,dist(p,next)/2.5),a={x:p.x+(at.x-p.x)*trim/dist(at,p),y:p.y+(at.y-p.y)*trim/dist(at,p)},b={x:p.x+(next.x-p.x)*trim/dist(p,next),y:p.y+(next.y-p.y)*trim/dist(p,next)};
            if(curveClear([a,p,b])){segments.push({type:'line',points:[pt(at),a]},{type:'curve',points:[a,pt(p),b]});at=b;rounded=true;break;}}
        }
        if(!rounded){segments.push({type:'line',points:[pt(at),pt(p)]});at=p;}
      }
    }
    const usable=segments.filter(s=>dist(s.points[0],s.points.at(-1))>1e-6);
    const samples=[];let length=0;for(const s of usable){const n=Math.max(s.type==='line'?2:24,Math.ceil(s.points.slice(1).reduce((d,q,i)=>d+dist(s.points[i],q),0)*2));for(let i=0;i<=n;i++){if(samples.length&&i===0)continue;const t=i/n;const p=s.type==='line'?{x:s.points[0].x+(s.points[1].x-s.points[0].x)*t,y:s.points[0].y+(s.points[1].y-s.points[0].y)*t}:bezier(s.points,t);if(samples.length)length+=dist(samples.at(-1),p);samples.push(p);}}
    let cursorSeg=-1;const stops=pins.map(p=>{for(let i=Math.max(cursorSeg,0);i<usable.length;i++)if(dist(usable[i].points.at(-1),p)<1e-6){cursorSeg=i;break;}return {...stopOf(p),segment:cursorSeg};});
    // Independent final check against the REAL (ungrown) zones, field elements and walls:
    // every chord of the sampled path, swept by the full footprint at the route heading.
    for(let i=1;i<samples.length;i++)if(!sweepClear(samples[i-1],samples[i],heading,all,footprint,field))throw Error('The smoothed route failed the footprint sweep check. Increase clearance or move the pins.');
    return {style,segments:usable,samples,length,heading,clearance,footprint,field,vertices:route,pins:pins.length,stops};
  }
  // ---------------------------------------------------------------- turning routes
  const norm=h=>((h%360)+540)%360-180,grown=(f,c)=>({front:f.front+c,rear:f.rear+c,half:f.half+c});
  // Turning in place costs the distance the footprint's farthest corner travels, so a turn is only
  // chosen when it saves more driving than that.
  const reach=f=>Math.hypot(Math.max(f.front,f.rear),f.half),turnCost=(degrees,f)=>Math.abs(degrees)*Math.PI/180*reach(f);
  // The whole footprint plus clearance must clear walls and obstacles at every degree of the turn.
  const turnClear=(p,from,to,all,footprint,field,clearance)=>safeSweep({x:p.x,y:p.y,heading:from},{x:p.x,y:p.y,heading:from+norm(to-from)},all,grown(footprint,clearance),field);
  function sampled(segments){const samples=[];let length=0;for(const s of segments)for(const p of s.points){if(samples.length){const d=dist(samples.at(-1),p);if(d<1e-9)continue;length+=d;}samples.push({x:p.x,y:p.y});}return {samples,length};}
  function stopsOf(segments,pins){let at=0;return pins.map(p=>{for(let i=at;i<segments.length;i++)if(dist(segments[i].points.at(-1),p)<1e-6){at=i;break;}return {...stopOf(p),segment:at};});}
  // Holonomic drivetrains (mecanum, swerve, X, Kiwi, H, butterfly) translate in any direction at a
  // fixed heading, so every heading gets its own grown-obstacle visibility graph. Turning in place
  // links neighbouring headings at the start, the pins and a coarse grid of turning spots wherever the
  // whole rotating footprint clears. One shortest-path search then decides when turning to fit is
  // shorter than driving around, and which way around an obstacle to go.
  const TURN_STEP=45;
  function planTurning(project,rawFootprint,fieldZones=[],rawField){
    const {footprint,field,start,all,pins,clearance}=prepare(project,rawFootprint,fieldZones,rawField),{dijkstra}=libs();if(!dijkstra)throw Error('Planning libraries are unavailable.');
    const headings=Array.from({length:360/TURN_STEP},(_,i)=>norm(start.heading+i*TURN_STEP)),spaces=headings.map(h=>space(all,footprint,field,h,clearance)),n=headings.length;
    const spacing=Math.max(18,Math.max(field.x1-field.x0,field.y1-field.y0)/8),hubs=[{x:start.x,y:start.y},...pins.map(p=>({x:p.x,y:p.y}))];
    for(let x=field.x0+spacing/2;x<field.x1;x+=spacing)for(let y=field.y0+spacing/2;y<field.y1;y+=spacing)hubs.push({x,y});
    const graph={},node=(i,name)=>graph[i+':'+name]??={},edge=(a,b,cost)=>{node(...a)[b.join(':')]=cost;node(...b)[a.join(':')]=cost;};
    const point=(i,name)=>name[0]==='v'?spaces[i].visibility().vertices[+name.slice(1)]:hubs[+name.slice(1)];
    for(let i=0;i<n;i++){
      const s=spaces[i],{vertices,graph:g}=s.visibility();for(const [a,links] of Object.entries(g)){node(i,a);for(const [b,c] of Object.entries(links))node(i,a)[i+':'+b]=c;}
      const free=hubs.map((p,h)=>s.free(p)?h:-1).filter(h=>h>=0);
      for(const h of free){node(i,'h'+h);for(let j=0;j<vertices.length;j++)if(segmentClear(hubs[h],vertices[j],s.polys))edge([i,'h'+h],[i,'v'+j],dist(hubs[h],vertices[j]));}
      for(let a=0;a<free.length;a++)for(let b=a+1;b<free.length;b++)if(segmentClear(hubs[free[a]],hubs[free[b]],s.polys))edge([i,'h'+free[a]],[i,'h'+free[b]],dist(hubs[free[a]],hubs[free[b]]));
    }
    for(let i=0;i<n;i++){const j=(i+1)%n;for(let h=0;h<hubs.length;h++)if(spaces[i].free(hubs[h])&&spaces[j].free(hubs[h])&&turnClear(hubs[h],headings[i],headings[j],all,footprint,field,clearance))edge([i,'h'+h],[j,'h'+h],turnCost(TURN_STEP,footprint));}
    const points=[{x:start.x,y:start.y,heading:start.heading,pin:true}];let at=0,hub=0;
    for(let leg=0;leg<pins.length;leg++){
      const goal=leg+1;if(dist(hubs[hub],hubs[goal])<.01){hub=goal;continue;}
      const local={...graph,G:{}};let reachable=false;for(let i=0;i<n;i++){const k=i+':h'+goal;if(graph[k]){local[k]={...graph[k],G:0};reachable=true;}}
      if(!reachable)throw Error(`Pin ${leg+1} leaves insufficient robot clearance at every heading.`);
      let keys;try{keys=dijkstra.find_path(local,at+':h'+hub,'G');}catch{throw Error(`No safe route to pin ${leg+1}, even turning the robot.`);}
      for(const k of keys.slice(1,-1)){const [i,name]=k.split(':'),p=point(+i,name);points.push({x:p.x,y:p.y,heading:headings[+i],index:+i,pin:name==='h'+goal});}
      at=+keys.at(-2).split(':')[0];hub=goal;points.at(-1).wait=pins[leg].wait;points.at(-1).action=pins[leg].action;
    }
    points[0].index=0;
    // Pull each same-heading stretch taut: skip intermediate corners and turning spots whenever the
    // straight line is clear at that heading. Pins and turns always stay.
    const taut=[points[0]];
    for(let i=1;i<points.length;){
      if(points[i].index!==taut.at(-1).index||dist(points[i],taut.at(-1))<1e-6){taut.push(points[i]);i++;continue;}
      let j=i;while(j+1<points.length&&points[j+1].index===taut.at(-1).index&&!points[j].pin&&spaces[taut.at(-1).index].clear(taut.at(-1),points[j+1]))j++;
      taut.push(points[j]);i=j+1;
    }
    const segments=[];let turnDegrees=0;
    for(let i=1;i<taut.length;i++){const a=taut[i-1],b=taut[i];
      if(Math.abs(norm(b.heading-a.heading))>1e-9){turnDegrees+=Math.abs(norm(b.heading-a.heading));continue;}
      if(dist(a,b)>1e-6)segments.push({type:'line',points:[{x:a.x,y:a.y},{x:b.x,y:b.y}],heading:a.heading});}
    if(!segments.length)throw Error('Place a pin away from the starting position.');
    // Independent final check against the real zones: each straight leg swept at its heading, and
    // each turn swept through every degree.
    let heading=start.heading;for(const s of segments){if(Math.abs(norm(s.heading-heading))>1e-9&&!safeSweep({...s.points[0],heading},{...s.points[0],heading:heading+norm(s.heading-heading)},all,footprint,field))throw Error('A turning route failed the footprint sweep check.');
      if(!sweepClear(s.points[0],s.points[1],s.heading,all,footprint,field))throw Error('A turning route failed the footprint sweep check.');heading=s.heading;}
    const {samples,length}=sampled(segments);
    return {style:'sharp',segments,samples,length,heading:start.heading,clearance,footprint,field,vertices:points,pins:pins.length,stops:stopsOf(segments,pins),turns:true,turnDegrees,cost:length+turnCost(turnDegrees,footprint)};
  }
  // Tank, tracked and differential robots only drive along their heading (forwards or in reverse) or
  // turn in place. A lattice search over short drive, reverse and turn moves finds where to back out
  // and line up when there is no room to turn; each expansion also tries turning to face the pin and
  // driving straight to it. The result is then straightened into the fewest stop-and-turn legs.
  const TANK_HEADINGS=16,TANK_STEP=2,TANK_LIMIT=60000;
  function planTankLattice(project,rawFootprint,fieldZones=[],rawField){
    const {footprint,field,start,all,pins,clearance}=prepare(project,rawFootprint,fieldZones,rawField),big=grown(footprint,clearance);
    const step=360/TANK_HEADINGS,headings=Array.from({length:TANK_HEADINGS},(_,i)=>norm(start.heading+i*step)),spaces=headings.map(h=>space(all,footprint,field,h,clearance));
    const turns=new Map(),turnOk=(p,k,j)=>{const key=`${Math.round(p.x*4)},${Math.round(p.y*4)},${Math.min(k,j)},${Math.max(k,j)}`;if(!turns.has(key))turns.set(key,turnClear(p,headings[k],headings[j],all,footprint,field,clearance));return turns.get(key);};
    // Turn at p from heading h, then drive straight to q, facing whichever way needs the smaller turn.
    const shot=(p,h,q)=>{const d=Math.atan2(q.y-p.y,q.x-p.x)*180/Math.PI;for(const face of [d,d+180].sort((a,b)=>Math.abs(norm(a-h))-Math.abs(norm(b-h)))){const to=h+norm(face-h);if(turnClear(p,h,to,all,footprint,field,clearance)&&sweepClear(p,q,to,all,big,field))return to;}return null;};
    function search(from,heading,goal){
      const k0=headings.findIndex(h=>Math.abs(norm(h-heading))<1e-6);
      if(k0<0){const to=shot(from,heading,goal);if(to!==null)return [{x:from.x,y:from.y,heading},{x:goal.x,y:goal.y,heading:to}];throw Error('Tank route needs room to turn the whole chassis.');}
      const open=[],push=s=>{open.push(s);let i=open.length-1;while(i){const up=(i-1)>>1;if(open[up].f<=open[i].f)break;[open[up],open[i]]=[open[i],open[up]];i=up;}};
      const pop=()=>{const top=open[0],last=open.pop();if(open.length){open[0]=last;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<open.length&&open[l].f<open[m].f)m=l;if(r<open.length&&open[r].f<open[m].f)m=r;if(m===i)break;[open[m],open[i]]=[open[i],open[m]];i=m;}}return top;};
      const seen=new Map(),keyOf=s=>`${Math.round(s.x)},${Math.round(s.y)},${s.k}`,turnStep=turnCost(step,footprint);
      push({x:from.x,y:from.y,k:k0,g:0,f:dist(from,goal),parent:null});let expanded=0;
      while(open.length&&expanded++<TANK_LIMIT){
        const s=pop(),key=keyOf(s);if(seen.has(key)&&seen.get(key)<=s.g)continue;seen.set(key,s.g);
        if(dist(s,goal)<24||expanded%6===1){const to=shot(s,headings[s.k],goal);if(to!==null){const path=[];for(let t=s;t;t=t.parent)path.unshift({x:t.x,y:t.y,heading:headings[t.k]});path.push({x:goal.x,y:goal.y,heading:to});return path;}}
        const space0=spaces[s.k],h=headings[s.k]*Math.PI/180;
        for(const sign of [1,-1]){const q={x:s.x+sign*TANK_STEP*Math.cos(h),y:s.y+sign*TANK_STEP*Math.sin(h)};if(space0.free(q)&&space0.clear(s,q)){const g=s.g+TANK_STEP*(sign<0?1.1:1);push({...q,k:s.k,g,f:g+dist(q,goal),parent:s});}}
        for(const d of [1,-1]){const j=(s.k+d+TANK_HEADINGS)%TANK_HEADINGS;if(spaces[j].free(s)&&turnOk(s,s.k,j)){const g=s.g+turnStep;push({x:s.x,y:s.y,k:j,g,f:g+dist(s,goal),parent:s});}}
      }
      throw Error('No tank route found: there is no room to back out and turn the chassis.');
    }
    // Merge the lattice moves into stop points, then skip any stop the robot can drive past directly.
    function straighten(path){
      const stops=[path[0]];for(let i=1;i<path.length;i++){const a=stops.at(-1),b=path[i],c=path[i+1];if(c&&Math.abs(norm(c.heading-b.heading))<1e-9&&Math.abs(norm(b.heading-a.heading))<1e-9&&Math.abs(cross(a,b,c))<1e-6)continue;stops.push(b);}
      const out=[stops[0]];let i=0,heading=stops[0].heading;
      while(i<stops.length-1){let next=i+1,face=stops[next].heading;
        for(let j=stops.length-1;j>i+1;j--){const to=shot(stops[i],heading,stops[j]);if(to!==null){next=j;face=to;break;}}
        if(next===i+1){const to=shot(stops[i],heading,stops[next]);if(to!==null)face=to;}
        out.push({...stops[next],heading:face});heading=face;i=next;}
      return out;
    }
    const segments=[];let cursor={x:start.x,y:start.y},heading=start.heading;
    for(let leg=0;leg<pins.length;leg++){const goal=pins[leg];if(dist(cursor,goal)<.01)continue;
      const path=straighten(search(cursor,heading,goal));
      for(let i=1;i<path.length;i++)if(dist(path[i-1],path[i])>1e-6)segments.push({type:'line',points:[{x:path[i-1].x,y:path[i-1].y},{x:path[i].x,y:path[i].y}],heading:path[i].heading});
      cursor=goal;heading=path.at(-1).heading;}
    if(!segments.length)throw Error('Place a pin away from the starting position.');
    const {samples,length}=sampled(segments);
    return {style:'sharp',segments,samples,length,heading:start.heading,clearance,footprint,field,vertices:[start,...pins],pins:pins.length,stops:stopsOf(segments,pins),nonholonomic:true,turns:true};
  }
  function tankRoute(route,zones,footprint,field){
    let heading=route.heading;const segments=route.segments.map((s,i)=>{
      if(s.type!=='line'||s.points.length!==2)throw Error('Replan this tank route as straight legs with chassis turns.');
      const [a,b]=s.points,target=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
      // Preserve a straight reverse instead of making an unnecessary 180-degree turn.
      const difference=(target-heading)*Math.PI/180,delta=Math.atan2(Math.sin(difference),Math.cos(difference))*180/Math.PI,next=Math.abs(delta)>90?target+180:target;
      if(!safeSweep({...a,heading},{...a,heading:next},zones,footprint,field)||!sweepClear(a,b,next,zones,footprint,field))throw Error(`Leg ${i+1} lacks chassis turning or driving clearance.`);
      heading=next;return {...s,heading};
    });
    return {...route,style:'sharp',nonholonomic:true,footprint,segments};
  }
  // The same route for the other alliance. mode 'rotate' turns everything 180° about the field centre
  // (BIOBUZZ is point-symmetric: the red GARDEN bottom-left matches the blue one top-right); mode 'mirror'
  // reflects it left-right (an empty field), which also reverses turn directions. Returns new start, pins
  // and zones; alliance-relative settings (hive cell, relative turns in 'rotate') stay as they are.
  function allianceRoute(layout,{mode='rotate',width=SIZE,height=SIZE}={}){
    const rot=mode!=='mirror',r3=v=>Math.round(v*1e6)/1e6,pt=q=>q&&finite(q.x)&&finite(q.y)?{...q,x:r3(width-q.x),y:r3(rot?height-q.y:q.y)}:q,hd=h=>finite(h)?norm(rot?h+180:180-h):h,turnBy=a=>finite(a)?(rot?a:-a):a;
    const zone=z=>{const out={...z,...pt(z)};if(z.type==='polygon')out.points=z.points.map(pt);if(finite(z.angle))out.angle=r3(rot?(z.angle+180)%360:(360-z.angle)%360);delete out.vertices;return out;};
    const path=raw=>{if(!raw||typeof raw!=='object')return raw;const p={...raw};if(p.target)p.target=pt(p.target);if(Array.isArray(p.controls))p.controls=p.controls.map(pt);
      if(p.rotate==='turn')p.heading=hd(p.heading);if(p.rotate==='relative')p.angle=turnBy(p.angle);if(p.rotate==='spin'&&finite(p.spins))p.spins=rot?p.spins:-p.spins;return p;};
    const pin=raw=>{const p={...raw,...pt(raw)};if(p.target)p.target=pt(p.target);if(finite(p.turn))p.turn=p.turnMode==='relative'?turnBy(p.turn):p.turnMode==='start'||p.turnMode==='track'?p.turn:hd(p.turn);if(p.path)p.path=path(p.path);return p;};
    return {start:layout.start?{...pt(layout.start),heading:hd(layout.start.heading)}:layout.start,pins:(layout.pins||[]).map(pin),zones:(layout.zones||[]).map(zone)};
  }
  return {allianceRoute,tangentAt,previewPoses,PREVIEW_SPEED,SIZE,FIELD,TOL,MIN_CLEARANCE,polygon,parts,zoneHits,triangulate,hull,body,overlap,contains,inside,safePose,safeSweep,sweepClear,dragPose,slidePose,segmentClear,validateZone,inflated,analyze,plan,planLoose,PHYSICS_ISSUES,shapeCandidates,planEffects,pinEffects,stepsOf,stepsName,MAX_STEPS,pathEffects,headingAt,pathEnd,pinHeading,pathDescription,pathAppearance,planFixed,planTurning,planTankLattice,tankRoute,dist};
});
