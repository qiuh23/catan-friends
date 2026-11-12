// Offline model preview, not a browser/GPU acceptance result.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {BoardAssets,Batches} from '../src/terrain.js';
import {BoardModels} from '../src/visuals/board-models.js';
import {createRoadLights} from '../src/visuals/road-lights.js';
import {addRoad} from '../src/pieces.js';
import {createHomeExample} from '../src/home-showcase.js';

globalThis.ProgressEvent??=class ProgressEvent{};
globalThis.FileReader=class FileReader{readAsArrayBuffer(blob){blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(data=>{this.result='data:'+blob.type+';base64,'+Buffer.from(data).toString('base64');this.onloadend?.();});}};
class Loader {async loadAsync(url){const data=await readFile(new URL('../public'+url,import.meta.url));return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');}}
const scene=new THREE.Scene(),assets=new BoardAssets(),models=new BoardModels({Loader}),state=createHomeExample(),b=state.board;
const center=b.tiles.find(t=>Math.abs(t.x)<.01&&Math.abs(t.z)<.01);
// Visual fixture: extend the central ring to inspect joints and owner colours.
for(const [i,edge] of b.edges.filter(edge=>edge.tiles.includes(center.id)).entries())edge.owner=i<3?'illustration':'blue';
state.players.push({id:'blue',color:'#4480bc'});
await models.prepare(b);models.terrain(b,scene);models.ports(b,scene);
const batch=new Batches(assets),color=id=>state.players.find(p=>p.id===id).color;
for(const edge of b.edges.filter(e=>e.owner))addRoad(batch,b.vertices[edge.a],b.vertices[edge.b],color(edge.owner));batch.finish(scene);
models.buildings(b.vertices.filter(v=>v.owner),color,scene);
const lamps=createRoadLights(scene);lamps.setBoard(b);lamps.setNight(1);
scene.updateMatrixWorld(true);
const flat=new THREE.Scene(),matrix=new THREE.Matrix4(),tint=new THREE.Color();
scene.traverse(object=>{
 if(!object.isMesh)return;
 const count=object.isInstancedMesh?object.count:1;
 for(let i=0;i<count;i++){
  let material=object.material.clone();
  if(object.name==='RoadLampPools')material=new THREE.MeshBasicMaterial({color:0xffbf72,transparent:true,opacity:.34,depthWrite:false});
  const mesh=new THREE.Mesh(object.geometry,material);mesh.name=object.name||'RoadOrTerrain';
  mesh.matrixAutoUpdate=false;mesh.matrix.copy(object.matrixWorld);
  if(object.isInstancedMesh){object.getMatrixAt(i,matrix);mesh.matrix.multiply(matrix);if(object.instanceColor){object.getColorAt(i,tint);material.color.multiply(tint);}}
  flat.add(mesh);
 }
});
const out=new URL('../test-results/roads/',import.meta.url);await mkdir(out,{recursive:true});
const glb=await new GLTFExporter().parseAsync(flat,{binary:true,onlyVisible:false});
await writeFile(new URL('roads-model.glb',out),Buffer.from(glb));await writeFile(new URL('board.json',out),JSON.stringify(b));
console.log(JSON.stringify({file:new URL('roads-model.glb',out).pathname,bytes:glb.byteLength,roads:b.edges.filter(e=>e.owner).length,lanterns:lamps.getState()}));
lamps.dispose();await models.dispose();assets.dispose();
