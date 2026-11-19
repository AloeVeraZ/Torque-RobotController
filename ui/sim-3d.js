/* Local DSIM/CAD field view with the app's own controls. Field frame: inches, bottom-left
   origin, +X right, +Y up (z up). Empty and DECODE fields use planar physics even in 3D. */
window.DeckSim3D={create(host,options){
  'use strict';
  const L=window.DeckThree,THREE=L.THREE,DEG=Math.PI/180;
  // `video: true` makes a run-video camera: a fixed-size picture with its own copy of the field, drawn only when
  // shoot() asks, either straight down at the whole field (2D, 'top') or following the robot (3D, 'chase').
  options=options||{};const video=!!options.video;let W=options.width||1280,H=options.height||720;
  host.innerHTML='<div class="sim-3d-canvas"></div><div class="sim-field-cube view-cube" aria-label="Field view cube"></div><p class="sim-3d-note hint" id="sim-3d-note"></p>';
  const box=host.querySelector('.sim-3d-canvas'),note=host.querySelector('#sim-3d-note');
  let renderer;try{renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:!!video});}catch{if(video)throw Error('Run videos need WebGL, which this device did not provide.');note.textContent='3D needs WebGL, which this device did not provide.';return {setField(){},setModel(){},update(){},resize(){},dispose(){}};}
  renderer.setPixelRatio(video?1:Math.min(2,devicePixelRatio||1));box.append(renderer.domElement);if(video)renderer.setSize(W,H,false);
  // Shader errors are not read back: each check waits for the GPU process, and the shaders are three.js's own.
  // PCF shadows: this three.js replaces PCFSoftShadowMap with PCFShadowMap at the first shadow pass, which threw away
  // every shader compiled before it and compiled them all again while drawing.
  renderer.debug.checkShaderErrors=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;if(video)renderer.shadowMap.autoUpdate=false;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,1,3000);camera.up.set(0,0,1);camera.position.set(72,-95,150);
  const top=new THREE.OrthographicCamera(-1,1,1,-1,1,3000);top.up.set(0,1,0);if(video){camera.fov=50;camera.aspect=W/H;camera.updateProjectionMatrix();}
  const controls=video?null:new L.OrbitControls(camera,renderer.domElement);if(controls){controls.target.set(72,72,0);controls.minPolarAngle=.001;controls.maxPolarAngle=Math.PI-.001;controls.enablePan=false;controls.update();}
  // The whole field in view from a direction, whatever the box's shape: the camera backs off along it until every corner of
  // the field (walls included) projects inside the picture. A fixed distance cropped the near corners on narrower boxes
  // (a 16:10 Mac window, a docked side panel). framed: the camera is still where it was put, so a resize refits it.
  let fieldBox=null,framed=true;
  function fitCamera(direction){if(!controls||!fieldBox)return false;const t=controls.target,d=new THREE.Vector3(...direction).normalize(),probe=camera.clone(),corners=[];
    for(const x of [fieldBox.x0,fieldBox.x1])for(const y of [fieldBox.y0,fieldBox.y1])for(const z of [0,fieldBox.z])corners.push(new THREE.Vector3(x,y,z));
    const fits=dist=>{probe.position.copy(d).multiplyScalar(dist).add(t);probe.lookAt(t);probe.updateMatrixWorld();probe.updateProjectionMatrix();return corners.every(c=>{const v=c.clone().project(probe);return Math.abs(v.x)<=.94&&Math.abs(v.y)<=.92&&v.z<1;});};
    let lo=controls.minDistance||10,hi=Math.max(lo*2,controls.maxDistance||600);if(!fits(hi))lo=hi;else for(let i=0;i<24;i++){const mid=(lo+hi)/2;if(fits(mid))hi=mid;else lo=mid;}
    camera.position.copy(d).multiplyScalar(Math.max(lo,hi)).add(t);controls.update();framed=true;return true;}
  const HOME=[0,-1.1,1.05];
  controls?.addEventListener('start',()=>{framed=false;});
  const navigator=video?null:window.DeckRobotModel.viewCube(host.querySelector('.sim-field-cube'),direction=>{const d=[...direction];if(!d[0]&&!d[1])d[0]=-.0001;const distance=Math.min(controls.maxDistance,Math.max(controls.minDistance,camera.position.distanceTo(controls.target)));if(!fitCamera(d)){camera.position.copy(new THREE.Vector3(...d).normalize().multiplyScalar(distance)).add(controls.target);controls.update();}schedule();},{controls,orbit:(dx,dy)=>{window.DeckRobotModel.orbitCamera(camera,controls,dx,dy);schedule();}});
  scene.add(new THREE.HemisphereLight(0xffffff,0x8b96a5,2.8),new THREE.AmbientLight(0xffffff,.5));const sun=new THREE.DirectionalLight(0xffffff,1.8);sun.position.set(130,-40,220);scene.add(sun);
  sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-180;sun.shadow.camera.right=180;sun.shadow.camera.top=180;sun.shadow.camera.bottom=-180;sun.shadow.bias=-.0005;
  const fieldGroup=new THREE.Group(),overlay=new THREE.Group(),trailGroup=new THREE.Group(),robotGroup=new THREE.Group(),estimateLine=new THREE.LineLoop(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({dashSize:1.5,gapSize:1}));estimateLine.visible=false;estimateLine.frustumCulled=false;scene.add(fieldGroup,overlay,trailGroup,robotGroup,estimateLine);
  let info=null,frame=null,state=null,body=null,raf=0,lastOverlay='',fieldKey='',fieldSequence=0,visual=null,markers=null,disposed=false;
  const markersHost=new THREE.Group(),ballsHost=new THREE.Group(),elementMarkers=new THREE.Group();scene.add(markersHost,ballsHost,elementMarkers);const ballMeshes=new Map(),ballWires=new Map();
  const css=name=>getComputedStyle(options.style||host).getPropertyValue(name).trim()||'#888',color=name=>new THREE.Color(css(name));
  function dispose(object){object.traverse(o=>{o.geometry?.dispose?.();for(const m of [].concat(o.material||[]))m.dispose?.();});}
  // The robot model's geometry belongs to the model module; only drop our own objects.
  function clear(group){for(const c of [...group.children]){group.remove(c);if(c.userData.keep!==true)dispose(c);}}
  const v3=(p,z=0)=>new THREE.Vector3(p.x,p.y,z);
  function prism(points,height,material,z=0){const m=new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(points.map(p=>new THREE.Vector2(p.x,p.y))),{depth:height,bevelEnabled:false}),material);m.position.z=z;return m;}
  function line(points,material,z){const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>v3(p,z))),material);if(material.isLineDashedMaterial)l.computeLineDistances();return l;}
  async function setField(nextInfo){
    info=nextInfo;scene.background=video?new THREE.Color(0x15181c):color('--bg');if(!info)return;const key=JSON.stringify([info.field,info.bounds]);
    const b=info?.bounds||{x0:0,y0:0,x1:144,y1:144},w=b.x1-b.x0,h=b.y1-b.y0;
    const cx=(b.x0+b.x1)/2,cy=(b.y0+b.y1)/2,span=Math.max(w,h);if(controls){controls.minDistance=span*.25;controls.maxDistance=span*2.15;}camera.near=Math.max(.25,span/200);camera.far=Math.max(3000,span*5);camera.updateProjectionMatrix();
    clear(markersHost);markers=window.DeckFieldArt.hitboxes(info,THREE,L);markersHost.add(markers.group);
    if(key!==fieldKey){fieldKey=key;const sequence=++fieldSequence,temporary=new THREE.Group();clear(fieldGroup);visual=null;clear(ballsHost);ballMeshes.clear();clear(elementMarkers);ballWires.clear();host.dataset.fieldReady='';host.setAttribute('aria-busy','true');
      controls?.target.set(cx,cy,4);camera.position.set(cx,cy-span*1.1,span*1.05);fieldBox={x0:b.x0-4,x1:b.x1+4,y0:b.y0-4,y1:b.y1+4,z:Math.min(24,span*.15)};if(controls)controls.maxDistance=span*3;fitCamera(HOME);sun.target.position.set(cx,cy,0);scene.add(sun.target);controls?.update();
      try{const next=await window.DeckFieldArt.build3d(temporary,info,THREE,L,{surface:color('--surface').lerp(color('--muted'),.18),line:color('--line-strong')},{own:!!video});if(disposed||sequence!==fieldSequence)return;fieldGroup.add(...temporary.children);visual=next;host.dataset.fieldReady=info.field;host.setAttribute('aria-busy','false');}
      catch(e){if(sequence===fieldSequence){fieldKey='';note.textContent='Field model could not load: '+e.message;host.setAttribute('aria-busy','false');}return;}}
    note.textContent=!info?'':info.physics==='3d'?'3D physics':'Flat (2D) physics, shown in 3D';
    lastOverlay='';trailKey='';trailMaterials.themed=false;estimateLine.material.color.copy(color('--warning'));robotModel();warm();schedule();
  }
  function robotModel(){
    clear(robotGroup);
    if(body){const c=body.clone();c.userData.keep=true;robotGroup.add(c);return;}
    const f=info?.footprint||{front:10.5,rear:7.5,half:9},len=f.front+f.rear;
    const chassis=new THREE.Mesh(new THREE.BoxGeometry(len,2*f.half,5),new THREE.MeshStandardMaterial({color:color('--text'),roughness:.6}));chassis.position.set((f.front-f.rear)/2,0,3);
    const nose=new THREE.Mesh(new THREE.ConeGeometry(2.4,5,3),new THREE.MeshStandardMaterial({color:color('--accent')}));nose.rotation.z=-Math.PI/2;nose.position.set(f.front-3,0,6.2);
    robotGroup.add(chassis,nose);
  }
  // A new body joins the scene once its shaders have compiled in the background, so a view on screen never stalls on them.
  function setModel(holder){
    body=holder||null;const next=body;if(!next||video||!renderer.compileAsync){robotModel();warm();schedule();return;}
    const trial=new THREE.Scene();trial.add(next.clone());renderer.compileAsync(trial,camera,scene).catch(()=>{}).then(()=>{if(body!==next||disposed)return;robotModel();warm();schedule();});
  }
  // Shaders compile in the background (KHR_parallel_shader_compile) as soon as the field or robot changes, and a
  // hidden view uploads its meshes when the page is idle, so the first picture shown does not stall the page. Each
  // shader's uniforms are read before that upload: the read waits for the GPU process, which is then idle.
  let warming=0;
  function warm(){if(video||!renderer.compileAsync)return;const n=++warming;prepare();Promise.all([renderer.compileAsync(scene,camera),shadowShaders()]).then(()=>{if(n!==warming||disposed)return;for(const p of renderer.info.programs||[])p.getUniforms?.();if(shown())return;(window.requestIdleCallback||setTimeout)(()=>{if(n===warming&&!disposed&&!shown()){prepare();renderer.render(scene,camera);}},{timeout:2000});}).catch(()=>{});}
  // The shadow pass draws every caster with a depth material of its own, which compileAsync does not see. One
  // stand-in per kind of caster (plain or instanced, coloured instances, which side) is compiled the same way, into
  // a target as the shadow map is, so the pass finds its shaders ready. The stand-ins stay, which keeps them cached.
  const standIns=new THREE.Scene(),standInKinds=new Set(),flip={[THREE.FrontSide]:THREE.BackSide,[THREE.BackSide]:THREE.FrontSide,[THREE.DoubleSide]:THREE.DoubleSide};
  function shadowShaders(){
    const fresh=[];scene.traverse(o=>{const m=[].concat(o.material||[])[0];if(!o.isMesh||!o.castShadow||!m)return;const side=m.shadowSide??flip[m.side]??THREE.BackSide,normals=!!o.geometry?.attributes?.normal,key=[!!o.isInstancedMesh,!!o.instanceColor,side,normals].join();
      if(standInKinds.has(key))return;standInKinds.add(key);const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0)]);if(normals)g.computeVertexNormals();
      const material=new THREE.MeshDepthMaterial({side}),stand=o.isInstancedMesh?new THREE.InstancedMesh(g,material,1):new THREE.Mesh(g,material);if(o.instanceColor)stand.setColorAt(0,new THREE.Color());fresh.push(stand);});
    if(!fresh.length)return Promise.resolve();const group=new THREE.Scene();group.add(...fresh);
    const target=new THREE.WebGLRenderTarget(1,1),before=renderer.getRenderTarget();renderer.setRenderTarget(target);const done=renderer.compileAsync(group,sun.shadow.camera,scene);renderer.setRenderTarget(before);
    return done.finally(()=>{standIns.add(...group.children);target.dispose();});
  }
  function overlays(){
    const s=state;if(!s)return;const l=s.layout,signature=JSON.stringify([l.zones,l.pins,l.route?.samples?.length,l.route?.length,s.start,info?.footprint]);if(signature===lastOverlay)return;lastOverlay=signature;clear(overlay);
    const red=new THREE.MeshStandardMaterial({color:color('--danger'),transparent:true,opacity:.45});
    for(const z of l.zones){const p=window.DeckPlanner.polygon(z);
      if(p.length===2){const [a,b]=p,m=new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(b.x-a.x,b.y-a.y),1,3),red);m.position.set((a.x+b.x)/2,(a.y+b.y)/2,1.5);m.rotation.z=Math.atan2(b.y-a.y,b.x-a.x);overlay.add(m);}
      else overlay.add(prism(p,12,red));}
    if(l.route?.segments?.length){const indices=window.DeckSimExport.pathIndex(l.route);for(const [i,seg]of l.route.segments.entries()){
      const path=l.pins[indices[i]]?.path,appearance=window.DeckPlanner.pathAppearance(path),points=Array.from({length:41},(_,j)=>{let ps=seg.points;const t=j/40;while(ps.length>1)ps=ps.slice(1).map((p,k)=>({x:ps[k].x+(p.x-ps[k].x)*t,y:ps[k].y+(p.y-ps[k].y)*t}));return ps[0];}),material=appearance.action?new THREE.LineDashedMaterial({color:appearance.color,dashSize:2.2,gapSize:1.2}):new THREE.LineBasicMaterial({color:appearance.color});
      overlay.add(line(points,material,.6));}}
    const pin=new THREE.MeshStandardMaterial({color:color('--accent')}),stop=new THREE.MeshStandardMaterial({color:color('--warning')});
    for(const q of l.pins){const m=new THREE.Mesh(new THREE.CylinderGeometry(1.6,1.6,4,16),q.wait>0?stop:pin);m.rotation.x=Math.PI/2;m.position.set(q.x,q.y,2);overlay.add(m);}
    if(s.start&&info){const c=window.DeckPlanner.body(s.start,info.footprint);overlay.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(c.map(p=>v3(p,.3))),new THREE.LineBasicMaterial({color:color('--muted')})));}
  }
  // The run's trail (and the sensor estimate's) grow with every frame: their lines are replaced on their own, with
  // materials that are kept, so the rest of the overlay is rebuilt (and its shaders compiled) only when the route changes.
  const trailMaterials={};let trailKey='';
  function trails(){
    const t=state?.trail||[],key=`${t.length}|${t.at(-1)?.x}|${t.at(-1)?.y}`;if(key===trailKey)return;trailKey=key;
    trailMaterials.line??=new THREE.LineBasicMaterial();trailMaterials.estimate??=new THREE.LineDashedMaterial({dashSize:2,gapSize:1.5});
    if(!trailMaterials.themed){trailMaterials.themed=true;trailMaterials.line.color.copy(color('--text'));trailMaterials.estimate.color.copy(color('--warning'));}
    for(const c of [...trailGroup.children]){trailGroup.remove(c);c.geometry.dispose();}
    if(t.length>1)trailGroup.add(line(t,trailMaterials.line,.4));const est=t.filter(p=>p.e).map(p=>p.e);if(est.length>1)trailGroup.add(line(est,trailMaterials.estimate,.5));
  }
  function update(nextFrame,nextState){frame=nextFrame;state=nextState||state;schedule();}
  function schedule(){if(!raf&&!video)raf=requestAnimationFrame(render);}
  // Draws now, from inside an animation frame (the run's glide), instead of on the next one.
  function drawNow(){if(raf){cancelAnimationFrame(raf);raf=0;}if(!video)render();}
  let boxSize=null;const lastCamera=new THREE.Matrix4();
  const watch=!video&&typeof ResizeObserver==='function'?new ResizeObserver(()=>{boxSize=null;schedule();}):null;watch?.observe(box);
  const shown=()=>{boxSize??={w:box.clientWidth,h:box.clientHeight};return boxSize.w>0&&boxSize.h>0;};
  function render(){
    raf=0;if(video||!host.isConnected||host.hidden||!shown())return;resize();prepare();
    // The view cube is redrawn only when the camera turns (the orbit controls move it by rounding noise every frame).
    controls.update();camera.updateMatrixWorld();if(camera.matrixWorld.elements.some((v,i)=>Math.abs(v-lastCamera.elements[i])>1e-6)){lastCamera.copy(camera.matrixWorld);navigator.update(camera);}renderer.render(scene,camera);
  }
  // Puts the robot, pieces and overlays where the frame shown now has them.
  function prepare(){
    overlays();trails();if(video)renderer.shadowMap.needsUpdate=true;
    const t=frame?.truth,p=t||state?.start;if(!robotGroup.children.length)robotModel();
    if(p){robotGroup.position.set(p.x,p.y,t?.z||0);robotGroup.rotation.set(0,0,p.heading*DEG);window.DeckRobotModel?.animate(robotGroup,frame);if(markers){markers.robot.position.copy(robotGroup.position);markers.robot.rotation.copy(robotGroup.rotation);}}
    markersHost.visible=!!state?.hitboxes;
    const world=frame?.fieldState;
    elementMarkers.visible=markersHost.visible;if(world&&markersHost.visible){const seen=new Set();for(const ball of world.balls){if(['held','stock','scored'].includes(ball.state?.kind))continue;seen.add(ball.id);let line=ballWires.get(ball.id);const radius=Number.isFinite(ball.r)?ball.r:info?.field==='biobuzz'?(ball.color==='yellow'?1.4:1.8):2.5;if(!line){line=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2*radius,2*radius,2*radius)),new THREE.LineBasicMaterial({color:0xff6373,depthTest:false}));line.renderOrder=12;ballWires.set(ball.id,line);elementMarkers.add(line);}line.position.set(ball.pos.x+72,ball.pos.y+72,(ball.z||0)+radius);}for(const [id,line]of ballWires)if(!seen.has(id)){elementMarkers.remove(line);dispose(line);ballWires.delete(id);}}
    if(world&&visual?.handles){L.updateBiobuzzField(visual.handles,world);L.updateBiobuzzElements(visual.elements,world);for(const a of ['red','blue'])if(markers?.trays[a]&&info?.trays?.[a])markers.trays[a].rotation.x=L.hiveTiltAngle(world,a)-info.trays[a].reference;}
    if(world&&info?.field==='decode'){const seen=new Set();for(const ball of world.balls){if(['held','stock','scored'].includes(ball.state?.kind))continue;seen.add(ball.id);let mesh=ballMeshes.get(ball.id);if(!mesh){mesh=new THREE.Mesh(new THREE.SphereGeometry(2.5,16,12),new THREE.MeshStandardMaterial({color:ball.color==='purple'?0x9d68cb:0x64bc70,roughness:.7}));mesh.castShadow=true;mesh.receiveShadow=true;ballMeshes.set(ball.id,mesh);ballsHost.add(mesh);}mesh.position.set(ball.pos.x+72,ball.pos.y+72,Math.max(0,ball.z||0)+2.5);}for(const [id,mesh]of ballMeshes)if(!seen.has(id)){ballsHost.remove(mesh);dispose(mesh);ballMeshes.delete(id);}}
    const e=frame?.estimate;estimateLine.visible=!!(e&&info);if(estimateLine.visible){const c=window.DeckPlanner.body(e,info.footprint),pos=estimateLine.geometry.attributes.position;
      if(pos?.count===c.length){c.forEach((q,i)=>pos.setXYZ(i,q.x,q.y,7));pos.needsUpdate=true;}else estimateLine.geometry.setFromPoints(c.map(q=>v3(q,7)));estimateLine.computeLineDistances();}
    beams();previewGhost();
  }
  // ---------------------------------------------------------------- route preview ghost
  // Plan → Paths preview: a see-through robot drives the planned route without physics. With an imported model it is
  // that model itself, faded (the same meshes, not a blocky stand-in); without one, a pushbot chassis. At pins it acts out the action with
  // see-through pieces: shots arc to the goal, the intake side glows and pulls pieces in, a pause rings the floor.
  // One hologram blue in both themes: the theme accent is near black in light mode, which reads as solid, not see-through.
  const GHOST=0x5cc8ff,previewGroup=new THREE.Group(),previewFx=new THREE.Group();scene.add(previewGroup,previewFx);
  let previewKey='',fx=null;
  function ghostLook(){const accent=new THREE.Color(GHOST);return {fill:new THREE.MeshStandardMaterial({color:accent,emissive:accent,emissiveIntensity:.4,transparent:true,opacity:.26,depthWrite:false,roughness:.85}),
    edge:new THREE.LineBasicMaterial({color:accent,transparent:true,opacity:.55,depthWrite:false})};}
  // The model's surface sampled into cubes about 1/14 of its largest size: a low-poly copy that stays cheap to draw.
  function blocks(holder,look){
    holder.updateMatrixWorld(true);const inv=holder.matrixWorld.clone().invert(),size=new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3()),cell=Math.max(.75,Math.max(size.x,size.y,size.z)/14);
    const cells=new Map(),m=new THREE.Matrix4(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),mark=(x,y,z)=>{const k=[Math.floor(x/cell),Math.floor(y/cell),Math.floor(z/cell)];cells.set(k.join(),k);};
    let triangles=0;holder.traverse(o=>{if(o.isMesh&&o.geometry?.attributes?.position)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});
    const stride=3*Math.max(1,Math.ceil(triangles/300000));
    holder.traverse(o=>{if(!o.isMesh||!o.geometry?.attributes?.position)return;m.multiplyMatrices(inv,o.matrixWorld);const pos=o.geometry.attributes.position,idx=o.geometry.index,count=idx?idx.count:pos.count,at=i=>idx?idx.getX(i):i;
      for(let i=0;i+2<count;i+=stride){a.fromBufferAttribute(pos,at(i)).applyMatrix4(m);b.fromBufferAttribute(pos,at(i+1)).applyMatrix4(m);c.fromBufferAttribute(pos,at(i+2)).applyMatrix4(m);
        const n=Math.min(24,Math.ceil(Math.max(a.distanceTo(b),b.distanceTo(c),c.distanceTo(a))/(cell*.5)));
        for(let u=0;u<=n;u++)for(let v=0;v<=n-u;v++){const p=n?u/n:0,q=n?v/n:0;mark(a.x+(b.x-a.x)*p+(c.x-a.x)*q,a.y+(b.y-a.y)*p+(c.y-a.y)*q,a.z+(b.z-a.z)*p+(c.z-a.z)*q);}}});
    const group=new THREE.Group(),list=[...cells.values()];if(!list.length)return group;
    const cube=Object.assign(new THREE.InstancedMesh(new THREE.BoxGeometry(cell*.94,cell*.94,cell*.94),look.fill,list.length),{frustumCulled:false}),place=new THREE.Matrix4(),corners=new THREE.EdgesGeometry(new THREE.BoxGeometry(cell,cell,cell)).attributes.position.array,lines=new Float32Array(list.length*corners.length);
    list.forEach(([i,j,k],n)=>{const x=(i+.5)*cell,y=(j+.5)*cell,z=(k+.5)*cell;cube.setMatrixAt(n,place.makeTranslation(x,y,z));for(let r=0;r<corners.length;r+=3){lines[n*corners.length+r]=corners[r]+x;lines[n*corners.length+r+1]=corners[r+1]+y;lines[n*corners.length+r+2]=corners[r+2]+z;}});
    const outline=new THREE.BufferGeometry();outline.setAttribute('position',new THREE.BufferAttribute(lines,3));
    group.add(cube,new THREE.LineSegments(outline,look.edge));return group;
  }
  // A pushbot: two rails and cross members, four wheels, a deck and an arm, sized to the footprint.
  function pushbot(f,look){
    const group=new THREE.Group(),len=f.front+f.rear,w=2*f.half,mid=(f.front-f.rear)/2;
    const part=(geometry,x,y,z,turn)=>{const mesh=new THREE.Mesh(geometry,look.fill),edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,30),look.edge);for(const o of [mesh,edges]){o.position.set(x,y,z);if(turn)o.rotation.set(...turn);}group.add(mesh,edges);};
    for(const s of [-1,1])part(new THREE.BoxGeometry(len,1.5,2),mid,s*(f.half-1.5),3);
    for(const s of [-1,1])part(new THREE.BoxGeometry(1.5,w-4.5,2),mid+s*(len/2-.75),0,3);
    part(new THREE.BoxGeometry(len-3,w-4.5,.3),mid,0,2.2);
    for(const sx of [-1,1])for(const sy of [-1,1])part(new THREE.CylinderGeometry(2,2,1.2,10),mid+sx*(len/2-3.2),sy*(f.half-.6),2);
    part(new THREE.BoxGeometry(1.5,1.5,10),mid-len*.2,0,7.2);part(new THREE.BoxGeometry(len*.55,1.2,1.2),mid-len*.2+len*.27,0,12.2);part(new THREE.BoxGeometry(1.2,4,3),mid-len*.2+len*.55,0,11.2);
    part(new THREE.ConeGeometry(1.8,3.6,3),f.front-2.5,0,5.2,[0,0,-Math.PI/2]);return group;
  }
  // The model itself, see-through: its own meshes (the geometry is shared, not copied) as they stand now, each with a
  // faded copy of its material. Writing depth keeps it a clean shell instead of every inner face showing through.
  let ghostMaterials=[];
  function seeThrough(holder){
    holder.updateMatrixWorld(true);const inv=holder.matrixWorld.clone().invert(),group=new THREE.Group(),made=new Map();group.userData.keep=true;
    const fade=m=>{if(!m)return m;if(!made.has(m)){const c=m.clone();c.transparent=true;c.opacity=.4;c.depthWrite=true;made.set(m,c);}return made.get(m);};
    const shown=o=>{for(let p=o;p&&p!==holder.parent;p=p.parent)if(p.visible===false)return false;return true;};
    holder.traverse(o=>{if(!o.isMesh||o.isInstancedMesh||o.isSkinnedMesh||!o.geometry?.attributes?.position||!shown(o))return;
      const mesh=new THREE.Mesh(o.geometry,Array.isArray(o.material)?o.material.map(fade):fade(o.material));mesh.matrixAutoUpdate=false;mesh.matrix.multiplyMatrices(inv,o.matrixWorld);mesh.frustumCulled=false;group.add(mesh);});
    ghostMaterials=[...made.values()];return group;}
  function ghostBody(){const f=info?.footprint||{front:9,rear:9,half:9},key=JSON.stringify([body?.uuid||'',f]);if(key===previewKey)return;previewKey=key;
    clear(previewGroup);for(const m of ghostMaterials)m.dispose();ghostMaterials=[];const look=ghostLook();
    // (A model with nothing to draw, or still loading, falls back to its coarse blocks.)
    const copy=body?seeThrough(body):null;previewGroup.add(copy?.children.length?copy:body?blocks(body,look):pushbot(f,look));previewGroup.traverse(o=>{o.renderOrder=9;});
    for(const v of Object.values(fx||{}))v.dispose();const accent=new THREE.Color(GHOST),see=o=>new THREE.MeshBasicMaterial({color:accent,transparent:true,depthWrite:false,...o});
    fx={piece:new THREE.SphereGeometry(1.8,10,8),ring:new THREE.RingGeometry(.92,1,48),torus:new THREE.TorusGeometry(2.6,.35,6,20),slab:new THREE.BoxGeometry(1,1,1),
      solid:see({opacity:.45}),glow:see({opacity:.2,side:THREE.DoubleSide}),pulse:see({side:THREE.DoubleSide}),
      line:new THREE.LineDashedMaterial({color:accent,transparent:true,opacity:.7,dashSize:2,gapSize:1.4,depthWrite:false})};}
  function previewGhost(){
    // The effects share fx's geometry and materials; only each frame's aim arcs are their own.
    for(const o of [...previewFx.children]){previewFx.remove(o);if(o.isLine)o.geometry.dispose();}
    const q=state?.preview;previewGroup.visible=!!q;if(!q)return;ghostBody();
    previewGroup.position.set(q.x,q.y,0);previewGroup.rotation.set(0,0,q.heading*DEG);
    const a=q.act;if(!a)return;const h=q.heading*DEG,c=Math.cos(h),s=Math.sin(h),f=q.fp||info?.footprint||{front:9,rear:9,half:9},at=(ox,oy)=>({x:q.x+ox*c-oy*s,y:q.y+ox*s+oy*c});
    const k=a.progress??(performance.now()/900)%1,keep=o=>{o.renderOrder=10;previewFx.add(o);return o;},mesh=(g,m)=>keep(new THREE.Mesh(g,m));
    // Anything with no picture of its own (a pause, a ramp, a turret angle, a moving part, the team's own action) rings the floor.
    if(!['intake','shoot','spin','aim'].includes(a.kind)){const ring=mesh(fx.ring,fx.pulse);fx.pulse.opacity=.5*(1-k);ring.scale.setScalar(Math.max(f.front,f.rear,f.half)+2+4*k);ring.position.set(q.x,q.y,.4);}
    if(a.kind==='intake')for(const side of a.intakes){const along=side==='front'||side==='back',sign=side==='front'||side==='left'?1:-1,edge=along?(sign>0?f.front:f.rear):f.half,span=along?2*f.half:f.front+f.rear;
      const o=along?at(sign*(edge+1.5),0):at((f.front-f.rear)/2,sign*(edge+1.5)),slab=mesh(fx.slab,fx.glow);slab.scale.set(along?3:span,along?span:3,4);slab.position.set(o.x,o.y,2.5);slab.rotation.set(0,0,h);
      for(let n=0;n<2;n++){const t=(k*2+n/2)%1,out=edge+12*(1-t),p=along?at(sign*out,(n?-1:1)*f.half*.4*(1-t)):at((n?-1:1)*f.half*.4*(1-t),sign*out),ball=mesh(fx.piece,fx.solid);ball.position.set(p.x,p.y,1.8);}}
    if(a.kind==='shoot'||a.kind==='aim'||a.kind==='spin')for(const sh of a.shooters){const [ox,oy]=window.DeckMechanisms.mountOffset(sh.mount,a.dims),o=at(ox,oy),dir=h+(sh.facing??0)*DEG;
      const goal=sh.facing===null&&a.target?{...a.target,z:22}:{x:o.x+Math.cos(dir)*48,y:o.y+Math.sin(dir)*48,z:2},from=new THREE.Vector3(o.x,o.y,12),to=new THREE.Vector3(goal.x,goal.y,goal.z),rise=Math.max(8,from.distanceTo(to)*.3);
      const arc=t=>from.clone().lerp(to,t).setZ(from.z+(to.z-from.z)*t+4*rise*t*(1-t));
      if(a.kind==='spin'){const spin=mesh(fx.torus,fx.solid);spin.position.copy(from);spin.rotation.set(Math.PI/2,0,dir+performance.now()/120);continue;}
      keep(new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({length:25},(_,j)=>arc(j/24))),fx.line)).computeLineDistances();
      if(a.kind==='shoot')for(let n=0;n<3;n++){const ball=mesh(fx.piece,fx.solid);ball.position.copy(arc((k*3+n/3)%1));}}
  }
  // ---------------------------------------------------------------- run video cameras
  const follow={};
  // Where each shooter points while the robot spins up, aims or shoots: from its spot on the robot along its
  // turret (or fixed facing) to the goal it points at, if one is within 25° of that line (sim-cameras.js).
  const aims=()=>window.DeckCameras.aims(frame,state?.aim);
  // A beam along each shooter's aim: amber while it spins up or turns, green once it is ready and on target.
  const beamGroup=new THREE.Group(),beamParts=[];scene.add(beamGroup);let beamList=[];
  function beams(){
    const list=beamList=aims();beamGroup.visible=list.length>0;
    list.forEach((b,n)=>{let p=beamParts[n];if(!p){const bar=new THREE.BoxGeometry(1,.7,.7);bar.translate(.5,0,0);p={bar:new THREE.Mesh(bar,new THREE.MeshBasicMaterial({transparent:true,opacity:.75,depthWrite:false})),end:new THREE.Mesh(new THREE.SphereGeometry(1.6,16,10),new THREE.MeshBasicMaterial({transparent:true,opacity:.85,depthWrite:false}))};p.bar.renderOrder=p.end.renderOrder=11;beamGroup.add(p.bar,p.end);beamParts[n]=p;}
      const hex=b.on?0x49cbb3:0xf2bc62;p.bar.material.color.setHex(hex);p.end.material.color.setHex(hex);p.bar.visible=p.end.visible=true;
      p.bar.position.set(b.x,b.y,13);p.bar.rotation.set(0,0,b.dir);p.bar.scale.set(b.len,1,1);p.end.position.set(b.x+Math.cos(b.dir)*b.len,b.y+Math.sin(b.dir)*b.len,13);});
    for(const p of beamParts.slice(list.length)){p.bar.visible=p.end.visible=false;}
  }
  // A beam passing within 10 in of a camera at P would fill its picture with a blur of colour, so that picture leaves
  // it out (a camera riding the turret, or trailing the robot as the turret swings past). No P draws every beam.
  function beamsFrom(P){
    beamList.forEach((b,n)=>{const p=beamParts[n],dx=Math.cos(b.dir)*b.len,dy=Math.sin(b.dir)*b.len,k=P?Math.max(0,Math.min(1,((P[0]-b.x)*dx+(P[1]-b.y)*dy)/(dx*dx+dy*dy||1))):0;
      p.bar.visible=p.end.visible=!P||Math.hypot(b.x+dx*k-P[0],b.y+dy*k-P[1],13-P[2])>10;});
  }
  // The orthographic camera straight above the field, fitted to a picture of the given shape.
  function fitTop(aspect,margin){const b=info?.bounds||{x0:0,y0:0,x1:144,y1:144},cx=(b.x0+b.x1)/2,cy=(b.y0+b.y1)/2,hh=Math.max((b.y1-b.y0)/2,(b.x1-b.x0)/2/aspect)*margin;
    Object.assign(top,{left:-hh*aspect,right:hh*aspect,top:hh,bottom:-hh});top.position.set(cx,cy,1000);top.lookAt(cx,cy,0);top.updateProjectionMatrix();}
  // The follow camera: behind the robot and above it, turning with it (smoothly, so turning on the spot does not
  // whip the picture round). While the robot spins up, aims or shoots, and for 2 s after, the camera swings
  // behind the robot towards the goal and pulls up, so the robot, its aim and where the pieces land are all in view.
  // A robot that has stood still for 1.5 s (parked, or waiting) is seen from further back and higher up. It keeps
  // out of the walls, the hive, the flowers and the robot, and does not film the robot through them, moving round
  // them as it goes (mainLive). (sim-cameras.js has the follow camera's own description: it is camera 1 of the Video
  // workspace.) A replay hands in each picture's pose, worked out over the whole run.
  let camFor=null,camField=null,camRig=null;
  function chase(dt,pose){
    const K=window.DeckCameras;
    if(!pose){if(camFor?.info!==info||camFor?.aim!==state?.aim||camFor?.body!==body){camFor={info,aim:state?.aim,body};camField=K.field(info);camRig=K.rig({footprint:info?.footprint,robot:info?.robot,mechanisms:info?.mechanisms,aim:state?.aim,turrets:body?.userData?.kin?.turrets});}
      pose=K.mainLive(follow,{frame,start:state?.start,aim:state?.aim,footprint:info?.footprint,bounds:info?.bounds,field:camField,rig:camRig},dt);}
    if(!pose)return;camera.fov=pose.fov||50;camera.updateProjectionMatrix();camera.position.set(...pose.p);camera.lookAt(...pose.l);
  }
  // Draws the next picture of a run video `dt` seconds after the last, from above ('top') or following the robot
  // ('chase', with `pose` when the camera was worked out ahead). The follow camera has the whole field from above in
  // its corner; `inset` says where, to frame it.
  function shoot(nextFrame,nextState,dt,view='chase',pose){
    frame=nextFrame;state=nextState||state;prepare();renderer.setScissorTest(false);renderer.setViewport(0,0,W,H);
    if(view==='top'){fitTop(W/H,1.06);renderer.render(scene,top);return {canvas:renderer.domElement,inset:null};}
    camera.fov=pose?.fov||50;camera.aspect=W/H;camera.updateProjectionMatrix();chase(dt,pose);beamsFrom(camera.position.toArray());renderer.render(scene,camera);
    const s=Math.round(H*.3),pad=Math.round(H*.03);fitTop(1,1.04);beamsFrom(null);renderer.setScissorTest(true);renderer.setScissor(W-s-pad,pad,s,s);renderer.setViewport(W-s-pad,pad,s,s);renderer.render(scene,top);renderer.setScissorTest(false);renderer.setViewport(0,0,W,H);
    return {canvas:renderer.domElement,inset:{x:W-s-pad,y:H-s-pad,size:s}};
  }
  // The Video workspace: one picture of the run seen by several cameras, each in its own rectangle of the canvas
  // ([x, y, w, h] from the top left). A shot is a camera pose ({p, l, fov}), or top: true for the whole field from
  // above; inset: true adds that top view in the corner, as the follow camera's videos have it.
  function picture(nextFrame,nextState,shots){
    frame=nextFrame;state=nextState||state;prepare();renderer.setScissorTest(true);
    // guides: false leaves out what is drawn for the planner's eyes, not the audience's: the shooters' aim beams, the
    // planned route with its pins, the driven trail and the sensor estimate, and the collision outlines.
    const plain=state?.guides===false;trailGroup.visible=!plain;overlay.visible=!plain;if(plain){beamGroup.visible=false;estimateLine.visible=false;markersHost.visible=false;elementMarkers.visible=false;}
    for(const s of shots){const [x,y,w,h]=s.rect,yb=H-y-h;renderer.setViewport(x,yb,w,h);renderer.setScissor(x,yb,w,h);
      if(s.top){fitTop(w/h,1.06);beamsFrom(null);renderer.render(scene,top);continue;}
      camera.fov=s.pose.fov;camera.aspect=w/h;camera.updateProjectionMatrix();camera.position.set(...s.pose.p);camera.lookAt(...s.pose.l);beamsFrom(s.pose.p);renderer.render(scene,camera);
      if(s.inset){const size=Math.round(h*.3),pad=Math.round(h*.03),ix=x+w-size-pad,iy=yb+pad;fitTop(1,1.04);beamsFrom(null);renderer.setViewport(ix,iy,size,size);renderer.setScissor(ix,iy,size,size);renderer.render(scene,top);s.insetRect={x:ix,y:y+h-pad-size,size};}}
    renderer.setScissorTest(false);renderer.setViewport(0,0,W,H);return renderer.domElement;
  }
  // A video camera's picture size.
  function size(w,h){if(!video||(w===W&&h===H))return;W=w;H=h;renderer.setSize(W,H,false);}
  function resize(){shown();const w=Math.max(1,boxSize.w),h=Math.max(1,boxSize.h),size=renderer.getSize(new THREE.Vector2());if(size.x!==w||size.y!==h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(framed&&controls)fitCamera(camera.position.clone().sub(controls.target).toArray());}}
  controls?.addEventListener('change',schedule);
  const themeObserver=new MutationObserver(()=>{if(info)setField(info);});themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});const scheme=matchMedia('(prefers-color-scheme: dark)'),themeChanged=()=>{if(info)setField(info);};scheme.addEventListener('change',themeChanged);
  return {setField,setModel,update,draw:drawNow,shoot,picture,size,canvas:()=>renderer.domElement,resize:()=>{boxSize=null;schedule();},dispose(){disposed=true;fieldSequence++;cancelAnimationFrame(raf);watch?.disconnect();themeObserver.disconnect();scheme.removeEventListener('change',themeChanged);navigator?.dispose();controls?.dispose();clear(scene);renderer.dispose();renderer.forceContextLoss();host.replaceChildren();}};
}};
