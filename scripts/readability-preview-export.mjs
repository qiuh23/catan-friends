// Offline inspection of runtime geometry, not a browser or phone screenshot.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {BoardAssets,Batches,buildTerrain} from '../src/terrain.js';
import {BoardModels} from '../src/visuals/board-models.js';
import {createRoadLights} from '../src/visuals/road-lights.js';
import {roadConnections} from '../src/visuals/road-geometry.js';
import {createRobberHighlight,ROBBER_HIGHLIGHT} from '../src/visuals/robber.js';
import {addRoad,addRoadJunction} from '../src/pieces.js';
import {createHomeExample} from '../src/home-showcase.js';

globalThis.ProgressEvent??=class ProgressEvent{};
globalThis.FileReader=class FileReader{readAsArrayBuffer(blob){blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(data=>{this.result='data:'+blob.type+';base64,'+Buffer.from(data).toString('base64');this.onloadend?.();});}};
class Loader {async loadAsync(url){const data=await readFile(new URL('../public'+url,import.meta.url));return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');}}
const scene=new THREE.Scene(),assets=new BoardAssets(),models=new BoardModels({Loader}),state=createHomeExample(),b=state.board;
const center=b.tiles.find(t=>Math.abs(t.x)<.01&&Math.abs(t.z)<.01);
// Deterministic public geometry fixture: same-owner loop, a branch, a blue road.
for(const edge of b.edges)edge.owner=null;
const ring=b.edges.filter(edge=>edge.tiles.includes(center.id));for(const edge of ring)edge.owner='illustration';
const v=ring[0].a,branch=b.edges.find(e=>(e.a===v||e.b===v)&&!e.owner);branch.owner='illustration';
const mixed=b.edges.find(e=>!e.owner&&(e.a===ring[2].a||e.b===ring[2].a));if(mixed)mixed.owner='blue';
state.players.push({id:'blue',color:'#4480bc'});
await models.prepare(b,{robber:true});const loaded=models.terrain(b,scene);models.ports(b,scene);buildTerrain(b,assets,scene,{loadedTiles:loaded,loadedPorts:true});
const batch=new Batches(assets),color=id=>state.players.find(p=>p.id===id)?.color||'#d57b4d',connections=roadConnections(b);
for(const edge of b.edges.filter(e=>e.owner))addRoad(batch,b.vertices[edge.a],b.vertices[edge.b],color(edge.owner),{ends:connections.ends(edge)});
for(const [id,owner]of connections.joined)addRoadJunction(batch,b.vertices[id],color(owner),connections.junctions.get(id));batch.finish(scene);
models.buildings(b.vertices.filter(v=>v.owner),color,scene);
const pose=models.robber(b,center,scene);scene.add(createRobberHighlight(assets,pose,center));
const lamps=createRoadLights(scene);lamps.setBoard(b);lamps.setNight(1);models.setNight(1);
scene.updateMatrixWorld(true);
const flat=new THREE.Scene(),matrix=new THREE.Matrix4(),tint=new THREE.Color();
scene.traverse(object=>{
 if(!object.isMesh)return;
 for(let i=0;i<(object.isInstancedMesh?object.count:1);i++){
  let material=object.material.clone();
  if(object.name==='RoadLampPools')material=new THREE.MeshBasicMaterial({color:0xffbf72,transparent:true,opacity:.34,depthWrite:false});
  const mesh=new THREE.Mesh(object.geometry,material);mesh.name=object.name||'RoadOrTerrain';
  if(models.robberMaterials.has(object.material))mesh.name='ReadabilityRobber';
  if(object.userData.robberHighlight)mesh.name='RobberFootHalo';
  mesh.matrixAutoUpdate=false;mesh.matrix.copy(object.matrixWorld);
  if(object.isInstancedMesh){object.getMatrixAt(i,matrix);mesh.matrix.multiply(matrix);if(object.instanceColor){object.getColorAt(i,tint);material.color.multiply(tint);}}
  flat.add(mesh);
 }
});
const out=new URL('../test-results/readability/',import.meta.url);await mkdir(out,{recursive:true});
await writeFile(new URL('scene.glb',out),Buffer.from(await new GLTFExporter().parseAsync(flat,{binary:true,onlyVisible:false})));
await writeFile(new URL('board.json',out),JSON.stringify(b));
await writeFile(new URL('highlight.json',out),JSON.stringify(ROBBER_HIGHLIGHT));
console.log(JSON.stringify({output:out.pathname,robber:{tile:center.id,...pose},junctions:connections.joined.size,roads:b.edges.filter(e=>e.owner).length}));
lamps.dispose();await models.dispose();assets.dispose();
