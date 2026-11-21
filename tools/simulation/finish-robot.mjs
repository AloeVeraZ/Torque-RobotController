// Reduce the native CAD export to a static body and the explicitly identified wheel groups.
// Only bundled examples use these groups. User STEP imports are always merged into one body.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as T from '../../.cache/simulation-deps/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../../.cache/simulation-deps/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {mergeGeometries,mergeVertices} from '../../.cache/simulation-deps/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import {MeshoptSimplifier as S} from '../../.cache/cad-build-deps/node_modules/meshoptimizer/meshopt_simplifier.module.js';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../..',import.meta.url)),id=process.argv[2];if(!['strafer','swechanum'].includes(id))throw Error('Select strafer or swechanum');
const output=path.join(root,'ui/assets/robots',id+'.glb'),raw=path.join(root,'.cache/simulation-cad',id+'-native.glb');if(!fs.existsSync(raw))fs.copyFileSync(output,raw);
const bytes=fs.readFileSync(raw),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');await S.ready;gltf.scene.updateMatrixWorld(true);
const report=[],groups=new Map(),simplified=new Map(),orientation=id==='strafer'?new T.Matrix4().set(0,-1,0,0,1,0,0,0,0,0,1,0,0,0,0,1):new T.Matrix4().set(0,1,0,0,1,0,0,0,0,0,-1,0,0,0,0,1);
function simplify(source){let g=simplified.get(source);if(!g){g=source.clone();for(const attr of Object.keys(g.attributes))if(attr!=='position')g.deleteAttribute(attr);g=mergeVertices(g,1e-5);const indices=new Uint32Array(g.index.array),p=g.attributes.position.array;
    const target=Math.min(indices.length,Math.max(12,Math.floor(indices.length*.1/3)*3)),[next]=S.simplify(indices,p,3,target,.02,['Prune']),copy=new Uint32Array(next),[remap,count]=S.compactMesh(copy),positions=new Float32Array(count*3);
    for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff)positions.set(p.subarray(i*3,i*3+3),remap[i]*3);
    g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(positions,3));g.setIndex(new T.BufferAttribute(copy,1));g.computeVertexNormals();simplified.set(source,g);}return g;}
// ---- The Strafer kit (id strafer) ---------------------------------------------------------------------------------
// Its STEP is the team's own assembly of goBILDA's Strafer (3209-0001-0007) with a REV Control Hub (REV-31-1595), a
// goBILDA Pinpoint (3110-0002-0002) and two 4-Bar Odometry Pods (3110-0001-0002) on it. Source frame: millimetres, the
// wheel axles at z = 0, 168 mm ahead of and behind the centre (Y) and 207 mm to each side (X). +Y is its front: the hub's
// USB side and the Pinpoint's X arrow both point that way. This GLB's frame: inches, front towards -x, the robot's
// right towards +y. The hub, the Pinpoint and each pod are groups of their own, so the app can move them
// (extras.deckPart); a pod is two, its mount on the channel and the carriage that swings down to the floor.
// Three wheel sets are in the file and the app shows one (extras.deckWheel.set, the diameter in mm): the kit's own
// 104 mm GripForce wheels, and goBILDA's 140 mm (from its 140 mm Strafer kit, 3209-0012-0002) and 96 mm (3213-3606-0002)
// mecanum wheels, each put on the same four axles with the roller hand the kit's wheel has at that corner.
const MM=1/25.4,AXLE={x:168*MM,y:207*MM},cornerOf=c=>(c.x<0?'front':'back')+(c.y<0?'Left':'Right'),pods=new Map();
function vertices(o,m=orientation){const out=[],v=new T.Vector3();o.traverse(c=>{if(!c.isMesh)return;const p=c.geometry.attributes.position;for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(c.matrixWorld).applyMatrix4(m);out.push(v.x,v.y,v.z);}});return out;}
// Principal axes of a point cloud (Jacobi on its covariance): [{value, axis}], widest first, and its centroid.
function axes(p){const n=p.length/3,c=[0,0,0];for(let i=0;i<p.length;i+=3)for(let k=0;k<3;k++)c[k]+=p[i+k]/n;const a=[[0,0,0],[0,0,0],[0,0,0]];
  for(let i=0;i<p.length;i+=3)for(let r=0;r<3;r++)for(let k=0;k<3;k++)a[r][k]+=(p[i+r]-c[r])*(p[i+k]-c[k])/n;
  const v=[[1,0,0],[0,1,0],[0,0,1]];for(let sweep=0;sweep<40;sweep++)for(const [i,j] of [[0,1],[0,2],[1,2]]){if(Math.abs(a[i][j])<1e-14)continue;const t=.5*Math.atan2(2*a[i][j],a[j][j]-a[i][i]),cs=Math.cos(t),sn=Math.sin(t);
    for(let k=0;k<3;k++){const x=a[k][i],y=a[k][j];a[k][i]=cs*x-sn*y;a[k][j]=sn*x+cs*y;}for(let k=0;k<3;k++){const x=a[i][k],y=a[j][k];a[i][k]=cs*x-sn*y;a[j][k]=sn*x+cs*y;}for(let k=0;k<3;k++){const x=v[k][i],y=v[k][j];v[k][i]=cs*x-sn*y;v[k][j]=sn*x+cs*y;}}
  return {centre:new T.Vector3(...c),list:[0,1,2].map(i=>({value:a[i][i],axis:new T.Vector3(v[0][i],v[1][i],v[2][i])})).sort((x,y)=>y.value-x.value)};}
// Which way a mecanum wheel's rollers slant, as +1 or -1: the same for a wheel however it is turned, opposite for its
// mirror image. Each long part out at the rim (a roller's tyre, core or pin) lies along its roller's axle.
function hand(node,centre,axle,radius,m=orientation){let sum=0;node.traverse(c=>{if(!c.isMesh)return;const e=axes(vertices(c,m)),r=e.centre.clone().sub(centre);r.addScaledVector(axle,-r.dot(axle));if(r.length()<.55*radius)return;
    const t=axle.clone().cross(r.normalize()),d=e.list[0].axis;sum+=d.dot(axle)*d.dot(t)*(e.list[0].value-e.list[1].value);});return Math.sign(sum);}
const kitHand={},kitWheels=new Map();
// A mesh of the kit's own CAD: the group it goes in ('' for the body).
function kitPart(o,names){const top=names[1]||'',add=(key,group)=>{if(!groups.has(key))groups.set(key,{name:key,parts:[],...group});return key;};
  if(/^3625-/.test(top)){const node=nodeOf(o,top);if(!kitWheels.has(node)){const box=new T.Box3().setFromBufferAttribute(new T.BufferAttribute(new Float32Array(vertices(node)),3)),c=box.getCenter(new T.Vector3()),corner=cornerOf(c),centre=new T.Vector3(Math.sign(c.x)*AXLE.x,Math.sign(c.y)*AXLE.y,0);
      kitHand[corner]=hand(node,centre,new T.Vector3(0,1,0),52*MM);kitWheels.set(node,add('104 '+corner,{kind:'mecanum',centre,radius:52*MM,extras:{set:104,corner}}));}return kitWheels.get(node);}
  if(/^REV-31-1595/.test(top))return add('REV Control Hub',{kind:'static',extras:{deckPart:{key:'hub'}}});
  if(/^3110-0002-/.test(top))return add('goBILDA Pinpoint',{kind:'static',extras:{deckPart:{key:'pinpoint'}}});
  if(/^3110-0001-/.test(top)){const node=nodeOf(o,top);if(!pods.has(node)){let wheel=null;node.traverse(c=>{if(/^3624-/.test(c.name))wheel=c;});const b=new T.Box3().setFromBufferAttribute(new T.BufferAttribute(new Float32Array(vertices(wheel)),3)),size=b.getSize(new T.Vector3());
      // The forward (X) pod's wheel rolls forward: it is thin across the robot.
      pods.set(node,size.y<size.x?'X (forward)':'Y (strafe)');}
    const which=pods.get(node),key=which[0]==='X'?'podX':'podY',mount=names.some(n=>/_Mount_/.test(n));
    return add(`goBILDA 4-Bar Odometry Pod ${which}${mount?' mount':''}`,{kind:'static',extras:{deckPart:{key,...(mount?{}:{carriage:true})}}});}
  return '';}
function nodeOf(o,name){for(let p=o;p;p=p.parent)if(p.name===name)return p;return o;}
gltf.scene.traverse(o=>{if(!o.isMesh)return;const names=[];for(let p=o;p;p=p.parent)if(p.name)names.unshift(p.name);const joined=names.join('/');let key='Body',kind='static';
  if(id==='strafer'){const k=kitPart(o,names);if(k===null)return;if(k)key=k;}
  else if(names.includes('Mechanum_1')){const assembly=names.find(n=>/^3625-/.test(n));if(assembly){key='Passive '+assembly;kind='mecanum';}}
  const pod=names.find(n=>/^A301_Ratchet/.test(n));
  if(id==='swechanum'&&pod&&!joined.includes('/=>')){const bounds=new T.Box3().setFromObject(o);if(bounds.min.z>=6.05){key='Steer '+pod;kind='steer';}}
  if(!groups.has(key))groups.set(key,{name:key,kind,parts:[]});
  const g=simplify(o.geometry);
  const placed=g.clone();placed.applyMatrix4(o.matrixWorld);placed.applyMatrix4(orientation);const color=(Array.isArray(o.material)?o.material[0]:o.material)?.color||new T.Color(.65,.68,.72),colors=new Float32Array(placed.attributes.position.count*3);for(let i=0;i<colors.length;i+=3){colors[i]=color.r;colors[i+1]=color.g;colors[i+2]=color.b;}placed.setAttribute('color',new T.BufferAttribute(colors,3));
  if(id==='swechanum'&&names.includes('Swerve1')&&joined.includes('/=>')){
    // These four named CAD compounds contain the wheel bodies; one mirrored pod exports its
    // gearbox and wheel as a single compound. Split on their measured, disjoint height ranges.
    const wheel=[],body=[],p=placed.attributes.position,indices=placed.index.array;for(let i=0;i<indices.length;i+=3){const dst=[0,1,2].every(j=>p.getZ(indices[i+j])< -6.1)?wheel:body;dst.push(indices[i],indices[i+1],indices[i+2]);}
    if(body.length){const part=placed.clone();part.setIndex(body);groups.get('Body').parts.push(part);}
    if(wheel.length){const pod=names.find(n=>/^A301_Ratchet/.test(n));if(!groups.has(pod))groups.set(pod,{name:pod,kind:'swerve',parts:[]});const part=placed.clone();part.setIndex(wheel);groups.get(pod).parts.push(part);}
  }else groups.get(key).parts.push(placed);
});
// The other two wheel sets, from goBILDA's own STEPs (tools/simulation/prepare-robot.py: strafer-140, mecanum-96-a, mecanum-96-b).
if(id==='strafer'){
  const load=async name=>{const file=path.join(root,'.cache/simulation-cad',name+'-native.glb');if(!fs.existsSync(file))throw Error(`Missing ${file}: run tools/simulation/prepare-robot.py first.`);const b=fs.readFileSync(file),g=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');g.scene.updateMatrixWorld(true);return g.scene;};
  const put=(set,corner,node,m)=>{const group={name:`${set} ${corner}`,kind:'mecanum',parts:[],radius:set/2*MM,extras:{set,corner}},sx=corner.startsWith('front')?-1:1,sy=corner.endsWith('Left')?-1:1;group.centre=new T.Vector3(sx*AXLE.x,sy*AXLE.y,0);
    node.traverse(o=>{if(!o.isMesh)return;const placed=simplify(o.geometry).clone();placed.applyMatrix4(o.matrixWorld);placed.applyMatrix4(m);placed.computeVertexNormals();const color=(Array.isArray(o.material)?o.material[0]:o.material)?.color||new T.Color(.2,.2,.22),colors=new Float32Array(placed.attributes.position.count*3);for(let i=0;i<colors.length;i+=3){colors[i]=color.r;colors[i+1]=color.g;colors[i+2]=color.b;}placed.setAttribute('color',new T.BufferAttribute(colors,3));group.parts.push(placed);});
    groups.set(group.name,group);};
  // 140 mm: the four wheels of goBILDA's 140 mm kit, each moved from its own axle onto this chassis's at the same corner.
  {const kit=await load('strafer-140'),top=kit.children[0];for(const node of top.children.filter(c=>/^3606-/.test(c.name))){const box=new T.Box3().setFromBufferAttribute(new T.BufferAttribute(new Float32Array(vertices(node)),3)),c=box.getCenter(new T.Vector3()),corner=cornerOf(c);
      const to=new T.Vector3(Math.sign(c.x)*AXLE.x,Math.sign(c.y)*AXLE.y,0);if(hand(node,c,new T.Vector3(0,1,0),70*MM)!==kitHand[corner])throw Error('The 140 mm wheel at '+corner+' slants the other way from the kit wheel there.');
      put(140,corner,node,new T.Matrix4().makeTranslation(to.x-c.x,to.y-c.y,to.z-c.z).multiply(orientation));}}
  // 96 mm: the set's two wheels (one of each hand), each in its own frame. Its axle is its thinnest way; it is stood
  // on each axle, the wheel whose rollers slant as the kit wheel's do at that corner.
  {const I=new T.Matrix4(),wheels=[];for(const name of ['mecanum-96-a','mecanum-96-b']){const node=await load(name),e=axes(vertices(node,I)),axle=e.list[2].axis.clone().normalize(),u=e.list[0].axis.clone().normalize(),w=axle.clone().cross(u);
      // Along its axle its middle is halfway between its two faces; across it, where its points balance.
      let lo=Infinity,hi=-Infinity;const p=vertices(node,I);for(let i=0;i<p.length;i+=3){const d=(p[i]-e.centre.x)*axle.x+(p[i+1]-e.centre.y)*axle.y+(p[i+2]-e.centre.z)*axle.z;lo=Math.min(lo,d);hi=Math.max(hi,d);}
      const centre=e.centre.clone().addScaledVector(axle,(lo+hi)/2),m=new T.Matrix4().makeBasis(w,axle,u).invert().multiply(new T.Matrix4().makeTranslation(-centre.x,-centre.y,-centre.z));
      wheels.push({node,m,hand:hand(node,new T.Vector3(),new T.Vector3(0,1,0),48*MM,m),width:hi-lo});}
    if(wheels[0].hand===wheels[1].hand||!wheels[0].hand)throw Error('The 96 mm set should be one wheel of each hand.');
    for(const corner of ['frontLeft','frontRight','backLeft','backRight']){const wheel=wheels.find(x=>x.hand===kitHand[corner]),sx=corner.startsWith('front')?-1:1,sy=corner.endsWith('Left')?-1:1;put(96,corner,wheel.node,new T.Matrix4().makeTranslation(sx*AXLE.x,sy*AXLE.y,0).multiply(wheel.m));}
    report.push({wheel96:wheels.map(x=>({hand:x.hand,widthMm:x.width/MM}))});}
  report.push({kitHand});
}
const data={asset:{version:'2.0',generator:'Deck Driver Station: OCP 7.9.3.1.1 / meshoptimizer 0.25.0'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[{pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],roughnessFactor:.5,metallicFactor:.25},doubleSided:true}],accessors:[],bufferViews:[],buffers:[{byteLength:0}]},chunks=[];let length=0;
function accessor(a,type,componentType,target,min,max){const buf=Buffer.from(a.buffer,a.byteOffset,a.byteLength),index=data.bufferViews.length;data.bufferViews.push({buffer:0,byteOffset:length,byteLength:buf.length,target});chunks.push(buf);length+=buf.length;const at=data.accessors.length;data.accessors.push({bufferView:index,componentType,count:a.length/(type==='VEC3'?3:1),type,...(min?{min,max}:{})});return at;}
let total=0;for(const group of groups.values()){
  if(!group.parts.length)continue;let g=mergeGeometries(group.parts,false);const kept=new Uint32Array(g.index.array),[remap,count]=S.compactMesh(kept),clean=new T.BufferGeometry();
  for(const [name,attr] of Object.entries(g.attributes)){const values=new Float32Array(count*attr.itemSize);for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff)values.set(attr.array.subarray(i*attr.itemSize,(i+1)*attr.itemSize),remap[i]*attr.itemSize);clean.setAttribute(name,new T.BufferAttribute(values,attr.itemSize));}clean.setIndex(new T.BufferAttribute(kept,1));g=clean;g.computeBoundingBox();const box=g.boundingBox,centre=box.getCenter(new T.Vector3());
  if(group.centre)centre.copy(group.centre);const wheel=['mecanum','swerve'].includes(group.kind),radius=group.radius||(group.kind==='mecanum'?104/25.4/2:(box.max.z-box.min.z)/2);
  if(wheel)g.translate(-centre.x,-centre.y,-centre.z);g.computeBoundingBox();total+=g.index.count/3;
  const attributes={POSITION:accessor(g.attributes.position.array,'VEC3',5126,34962,g.boundingBox.min.toArray(),g.boundingBox.max.toArray()),NORMAL:accessor(g.attributes.normal.array,'VEC3',5126,34962),COLOR_0:accessor(g.attributes.color.array,'VEC3',5126,34962)};
  const mesh=data.meshes.length;data.meshes.push({name:group.name,primitives:[{attributes,indices:accessor(new Uint32Array(g.index.array),'SCALAR',5125,34963),material:0}]});
  data.scenes[0].nodes.push(data.nodes.length);data.nodes.push({name:wheel?'DeckWheel '+group.name:group.name,mesh,translation:wheel?centre.toArray():[0,0,0],...(wheel?{extras:{deckWheel:{kind:group.kind,radius,axis:group.kind==='mecanum'?[0,1,0]:[-1,0,0],...group.extras}}}:group.kind==='steer'?{extras:{deckSteerBody:{pod:'DeckWheel '+group.name.slice(6)}}}:group.extras?{extras:group.extras}:{})});
  report.push({name:group.name,kind:group.kind,centre:centre.toArray(),radius,triangles:g.index.count/3});
}
data.buffers[0].byteLength=length;const json=Buffer.from(JSON.stringify(data)),pad=(4-json.length%4)%4,j=Buffer.concat([json,Buffer.alloc(pad,32)]),bin=Buffer.concat(chunks),header=Buffer.alloc(20),tail=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+j.length+bin.length,8);header.writeUInt32LE(j.length,12);header.writeUInt32LE(0x4e4f534a,16);tail.writeUInt32LE(bin.length);tail.writeUInt32LE(0x004e4942,4);fs.writeFileSync(output+'.gz',gzipSync(Buffer.concat([header,j,tail,bin]),{level:9}));
console.log(id,Math.round(bin.length/1024/1024)+' MiB',total,'triangles',JSON.stringify(report));
const catalogFile=path.join(root,'ui/assets/robots/catalog.json');if(fs.existsSync(catalogFile)){const catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));{const hash=createHash('sha256').update(fs.readFileSync(output+'.gz')).digest('hex'),known=[catalog[id].assetSha256].flat().filter(Boolean);catalog[id].assetSha256=known.includes(hash)?catalog[id].assetSha256:[...known,hash];}fs.writeFileSync(catalogFile,JSON.stringify(catalog,null,2)+'\n');}
