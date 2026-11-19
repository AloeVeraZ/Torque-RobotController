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
const report=[],groups=new Map(),simplified=new Map(),orientation=id==='strafer'?new T.Matrix4().set(0,1,0,0,-1,0,0,0,0,0,1,0,0,0,0,1):new T.Matrix4().set(0,1,0,0,1,0,0,0,0,0,-1,0,0,0,0,1);
gltf.scene.traverse(o=>{if(!o.isMesh)return;const names=[];for(let p=o;p;p=p.parent)if(p.name)names.unshift(p.name);const joined=names.join('/');let key='Body',kind='static';
  if(id==='strafer'){const assembly=names.find(n=>/^3625-/.test(n));if(assembly){key=assembly;kind='mecanum';}}
  else if(names.includes('Mechanum_1')){const assembly=names.find(n=>/^3625-/.test(n));if(assembly){key='Passive '+assembly;kind='mecanum';}}
  const pod=names.find(n=>/^A301_Ratchet/.test(n));
  if(id==='swechanum'&&pod&&!joined.includes('/=>')){const bounds=new T.Box3().setFromObject(o);if(bounds.min.z>=6.05){key='Steer '+pod;kind='steer';}}
  if(!groups.has(key))groups.set(key,{name:key,kind,parts:[]});
  let g=simplified.get(o.geometry);if(!g){g=o.geometry.clone();for(const attr of Object.keys(g.attributes))if(attr!=='position')g.deleteAttribute(attr);g=mergeVertices(g,1e-5);const indices=new Uint32Array(g.index.array),p=g.attributes.position.array;
    const target=Math.min(indices.length,Math.max(12,Math.floor(indices.length*.1/3)*3)),[next]=S.simplify(indices,p,3,target,.02,['Prune']),copy=new Uint32Array(next),[remap,count]=S.compactMesh(copy),positions=new Float32Array(count*3);
    for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff)positions.set(p.subarray(i*3,i*3+3),remap[i]*3);
    g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(positions,3));g.setIndex(new T.BufferAttribute(copy,1));g.computeVertexNormals();simplified.set(o.geometry,g);}
  const placed=g.clone();placed.applyMatrix4(o.matrixWorld);placed.applyMatrix4(orientation);const color=(Array.isArray(o.material)?o.material[0]:o.material)?.color||new T.Color(.65,.68,.72),colors=new Float32Array(placed.attributes.position.count*3);for(let i=0;i<colors.length;i+=3){colors[i]=color.r;colors[i+1]=color.g;colors[i+2]=color.b;}placed.setAttribute('color',new T.BufferAttribute(colors,3));
  if(id==='swechanum'&&names.includes('Swerve1')&&joined.includes('/=>')){
    // These four named CAD compounds contain the wheel bodies; one mirrored pod exports its
    // gearbox and wheel as a single compound. Split on their measured, disjoint height ranges.
    const wheel=[],body=[],p=placed.attributes.position,indices=placed.index.array;for(let i=0;i<indices.length;i+=3){const dst=[0,1,2].every(j=>p.getZ(indices[i+j])< -6.1)?wheel:body;dst.push(indices[i],indices[i+1],indices[i+2]);}
    if(body.length){const part=placed.clone();part.setIndex(body);groups.get('Body').parts.push(part);}
    if(wheel.length){const pod=names.find(n=>/^A301_Ratchet/.test(n));if(!groups.has(pod))groups.set(pod,{name:pod,kind:'swerve',parts:[]});const part=placed.clone();part.setIndex(wheel);groups.get(pod).parts.push(part);}
  }else groups.get(key).parts.push(placed);
});
const data={asset:{version:'2.0',generator:'Deck Driver Station: OCP 7.9.3.1.1 / meshoptimizer 0.25.0'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],materials:[{pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],roughnessFactor:.5,metallicFactor:.25},doubleSided:true}],accessors:[],bufferViews:[],buffers:[{byteLength:0}]},chunks=[];let length=0;
function accessor(a,type,componentType,target,min,max){const buf=Buffer.from(a.buffer,a.byteOffset,a.byteLength),index=data.bufferViews.length;data.bufferViews.push({buffer:0,byteOffset:length,byteLength:buf.length,target});chunks.push(buf);length+=buf.length;const at=data.accessors.length;data.accessors.push({bufferView:index,componentType,count:a.length/(type==='VEC3'?3:1),type,...(min?{min,max}:{})});return at;}
let total=0;for(const group of groups.values()){
  if(!group.parts.length)continue;let g=mergeGeometries(group.parts,false);const kept=new Uint32Array(g.index.array),[remap,count]=S.compactMesh(kept),clean=new T.BufferGeometry();
  for(const [name,attr] of Object.entries(g.attributes)){const values=new Float32Array(count*attr.itemSize);for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff)values.set(attr.array.subarray(i*attr.itemSize,(i+1)*attr.itemSize),remap[i]*attr.itemSize);clean.setAttribute(name,new T.BufferAttribute(values,attr.itemSize));}clean.setIndex(new T.BufferAttribute(kept,1));g=clean;g.computeBoundingBox();const box=g.boundingBox,centre=box.getCenter(new T.Vector3());
  const wheel=['mecanum','swerve'].includes(group.kind),radius=group.kind==='mecanum'?104/25.4/2:(box.max.z-box.min.z)/2;
  if(wheel)g.translate(-centre.x,-centre.y,-centre.z);g.computeBoundingBox();total+=g.index.count/3;
  const attributes={POSITION:accessor(g.attributes.position.array,'VEC3',5126,34962,g.boundingBox.min.toArray(),g.boundingBox.max.toArray()),NORMAL:accessor(g.attributes.normal.array,'VEC3',5126,34962),COLOR_0:accessor(g.attributes.color.array,'VEC3',5126,34962)};
  const mesh=data.meshes.length;data.meshes.push({name:group.name,primitives:[{attributes,indices:accessor(new Uint32Array(g.index.array),'SCALAR',5125,34963),material:0}]});
  data.scenes[0].nodes.push(data.nodes.length);data.nodes.push({name:wheel?'DeckWheel '+group.name:group.name,mesh,translation:wheel?centre.toArray():[0,0,0],...(wheel?{extras:{deckWheel:{kind:group.kind,radius,axis:group.kind==='mecanum'?[0,1,0]:[-1,0,0]}}}:group.kind==='steer'?{extras:{deckSteerBody:{pod:'DeckWheel '+group.name.slice(6)}}}:{})});
  report.push({name:group.name,kind:group.kind,centre:centre.toArray(),radius,triangles:g.index.count/3});
}
data.buffers[0].byteLength=length;const json=Buffer.from(JSON.stringify(data)),pad=(4-json.length%4)%4,j=Buffer.concat([json,Buffer.alloc(pad,32)]),bin=Buffer.concat(chunks),header=Buffer.alloc(20),tail=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+j.length+bin.length,8);header.writeUInt32LE(j.length,12);header.writeUInt32LE(0x4e4f534a,16);tail.writeUInt32LE(bin.length);tail.writeUInt32LE(0x004e4942,4);fs.writeFileSync(output+'.gz',gzipSync(Buffer.concat([header,j,tail,bin]),{level:9}));
console.log(id,Math.round(bin.length/1024/1024)+' MiB',total,'triangles',JSON.stringify(report));
const catalogFile=path.join(root,'ui/assets/robots/catalog.json');if(fs.existsSync(catalogFile)){const catalog=JSON.parse(fs.readFileSync(catalogFile,'utf8'));{const hash=createHash('sha256').update(fs.readFileSync(output+'.gz')).digest('hex'),known=[catalog[id].assetSha256].flat().filter(Boolean);catalog[id].assetSha256=known.includes(hash)?catalog[id].assetSha256:[...known,hash];}fs.writeFileSync(catalogFile,JSON.stringify(catalog,null,2)+'\n');}
