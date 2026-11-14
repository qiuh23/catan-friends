import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Board} from '../src/board3d.js';
import {BoardAssets,Batches,clearLayer} from '../src/terrain.js';
import {addRoadNetwork,addBoardBuildings} from '../src/pieces.js';
import {createHomePieces} from '../src/visuals/home-pieces.js';
import {BoardModels,ARCHITECTURE_URL,buildingAsset} from '../src/visuals/board-models.js';
import {createHomeExample,showcasePose,SHOWCASE_SETTLED_SECONDS} from '../src/home-showcase.js';

const fallback=()=>({buildings:()=>new Set(),releaseLayer(){}});
const color=()=> '#b65c35';
function visibleInstances(layer,geometryKey=mesh=>mesh.geometry.uuid) {
  layer.updateMatrixWorld(true);const entries=[],local=new THREE.Matrix4(),world=new THREE.Matrix4();
  layer.traverseVisible(mesh=>{
    if(!mesh.isInstancedMesh)return;
    for(let i=0;i<mesh.count;i++) {
      mesh.getMatrixAt(i,local);world.multiplyMatrices(mesh.matrixWorld,local);
      entries.push(JSON.stringify([geometryKey(mesh),...world.elements,...Array.from(mesh.instanceColor?.array.slice(i*3,i*3+3)||[])].map(v=>typeof v==='number'?Math.round(v*1e5)/1e5:v)));
    }
  });return entries.sort();
}

test('settled home and match use identical road joins, dimensions, owner colors and building fallback transforms',()=>{
  const state=createHomeExample(),assets=new BoardAssets(),models=fallback(),home=new THREE.Group(),match=new THREE.Group();
  const demo=createHomePieces(state,{assets,models,layer:home}),batch=new Batches(assets);
  const links=addRoadNetwork(batch,state.board,color);addBoardBuildings(batch,state.board.vertices.filter(v=>v.owner),color,models,match);batch.finish(match);
  demo.animate(showcasePose(SHOWCASE_SETTLED_SECONDS,state.homeDemo));
  assert.deepEqual([...demo.connections.joined],[...links.joined]);assert.equal(links.joined.size,5);
  assert.deepEqual(visibleInstances(home),visibleInstances(match));
  assert.ok(home.children.filter(o=>o.isInstancedMesh).length<=8,'all six roads and five joins share at most eight draws');
  demo.dispose();clearLayer(match);assets.dispose();
});

test('actual loaded home buildings match the in-game asset geometry, owner tint and settled placement',async()=>{
  class LocalLoader {async loadAsync(url){const bytes=await readFile(new URL('../public'+url,import.meta.url));return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}}
  const state=createHomeExample(),assets=new BoardAssets(),models=new BoardModels({Loader:LocalLoader}),home=new THREE.Group(),match=new THREE.Group();
  const urls=models.required(state.board,{homeDemo:state.homeDemo}).filter(url=>url.startsWith(ARCHITECTURE_URL)&&!url.includes('pier'));
  await Promise.all(urls.map(url=>models.load(url)));
  const demo=createHomePieces(state,{assets,models,layer:home}),batch=new Batches(assets);
  addRoadNetwork(batch,state.board,color);addBoardBuildings(batch,state.board.vertices.filter(v=>v.owner),color,models,match);batch.finish(match);
  demo.animate(showcasePose(SHOWCASE_SETTLED_SECONDS));
  const signatures=new Map(),signature=mesh=>{
    const geometry=mesh.geometry;if(!signatures.has(geometry)){
      const hash=createHash('sha256');for(const array of [geometry.attributes.position.array,geometry.index?.array].filter(Boolean))hash.update(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));
      signatures.set(geometry,hash.digest('hex')+':'+mesh.material.name);
    }return signatures.get(geometry);
  };
  assert.deepEqual(visibleInstances(home,signature),visibleInstances(match,signature));
  demo.dispose();models.releaseLayer(match);clearLayer(match);assets.dispose();await models.dispose();
});

test('shared network handles mixed owners and blocking buildings equally in home and match',()=>{
  for(const change of ['mixed','blocked']) {
    const state=createHomeExample(),middle=state.homeDemo.roads[2];
    if(change==='mixed'){state.board.edges[middle.edge].owner='blue';state.players.push({id:'blue',color:'#487d9a'});}
    else state.board.vertices[middle.from].owner='blue';
    const assets=new BoardAssets(),home=new THREE.Group(),match=new THREE.Group(),models=fallback(),batch=new Batches(assets);
    const colors=id=>state.players.find(p=>p.id===id)?.color||'#e57c54';
    const demo=createHomePieces(state,{assets,models,layer:home}),links=addRoadNetwork(batch,state.board,colors);batch.finish(match);
    demo.animate(showcasePose(SHOWCASE_SETTLED_SECONDS,state.homeDemo));
    assert.deepEqual([...demo.connections.joined],[...links.joined]);assert.ok(!links.joined.has(middle.from));
    // Compare only the road pool; houses are tested separately above.
    for(const group of home.children.filter(o=>o.isGroup))group.visible=false;
    assert.deepEqual(visibleInstances(home),visibleInstances(match));demo.dispose();clearLayer(match);assets.dispose();
  }
});

test('road corners wait for adjoining roads and replay does not allocate or mutate example state',()=>{
  const state=createHomeExample(),before=JSON.stringify(state),assets=new BoardAssets(),layer=new THREE.Group();
  const demo=createHomePieces(state,{assets,models:fallback(),layer}),meshes=[...layer.children],geometries=Object.values(assets.geometries),buffers=meshes.filter(m=>m.isInstancedMesh).map(m=>m.instanceMatrix);
  demo.animate(showcasePose(5,state.homeDemo));
  for(const mesh of meshes.filter(m=>m.isInstancedMesh))mesh.userData.pieces.forEach((piece,i)=>{
    if(piece.kind==='junction'){const matrix=new THREE.Matrix4();mesh.getMatrixAt(i,matrix);assert.equal(matrix.determinant(),0,'corner must not float before the next road arrives');}
  });
  const snapshot=()=>meshes.filter(m=>m.isInstancedMesh).map(m=>Array.from(m.instanceMatrix.array));
  demo.animate(showcasePose(SHOWCASE_SETTLED_SECONDS));const settled=snapshot();
  for(let cycle=0;cycle<12;cycle++)for(let step=0;step<120;step++)demo.animate(showcasePose(cycle*30+step*.25));
  demo.animate(showcasePose(SHOWCASE_SETTLED_SECONDS));assert.deepEqual(snapshot(),settled);
  assert.deepEqual(layer.children,meshes);assert.deepEqual(Object.values(assets.geometries),geometries);assert.deepEqual(meshes.filter(m=>m.isInstancedMesh).map(m=>m.instanceMatrix),buffers);assert.equal(JSON.stringify(state),before);
  demo.dispose();assert.equal(layer.children.length,0);demo.dispose();assets.dispose();
});

test('home requests only its real model variants, shares the model cache and releases handles on repeated rebuilds',async()=>{
  const state=createHomeExample(),assets=new BoardAssets(),models=new BoardModels(),layer=new THREE.Group();
  const required=models.required(state.board,{homeDemo:state.homeDemo}),architecture=required.filter(url=>url.startsWith(ARCHITECTURE_URL)&&!url.includes('pier'));
  const expected=state.homeDemo.buildings.flatMap(({vertex,upgradeAt})=>[1,...(upgradeAt===undefined?[]:[2])].map(level=>`${ARCHITECTURE_URL}${buildingAsset({...state.board.vertices[vertex],level})}.glb`));
  assert.deepEqual(new Set(architecture),new Set(expected));assert.equal(architecture.length,new Set(architecture).size);assert.ok(architecture.length<=4);
  for(const url of architecture){const source=new THREE.Group();source.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));models.ready.set(url,source);}
  for(let i=0;i<4;i++) {
    const demo=createHomePieces(state,{assets,models,layer});demo.animate(showcasePose(SHOWCASE_SETTLED_SECONDS));assert.equal(models.layers.size,6);
    const meshes=[];layer.traverse(m=>{if(m.isInstancedMesh)meshes.push(m);});let released=0;for(const m of meshes)m.addEventListener('dispose',()=>released++);
    demo.dispose();assert.equal(models.layers.size,0);assert.equal(released,meshes.length);assert.equal(layer.children.length,0);
  }
  // These test fixtures were inserted directly rather than owned by the loader.
  for(const source of models.ready.values())source.traverse(m=>{if(m.isMesh){m.geometry.dispose();m.material.dispose();}});
  assets.dispose();await models.dispose();
});

test('reduced motion settles all four homes and model reloads keep that state; clearing removes demo resources',()=>{
  const state=createHomeExample(),assets=new BoardAssets(),scene=new THREE.Scene();
  const view=Object.assign(Object.create(Board.prototype),{latestState:state,assets,models:fallback(),scene,homeShowcase:true,homeTime:4,renderer:{domElement:{dataset:{}}},roadLights:{setBoard(){},setReveal(){}},environment:{update(){},lighting:{markDirty(){}}},controls:{},syncScene(){},invalidate(){},stopAmbient(){this.stopped=true;},scheduleAmbient(){throw Error('reduced motion must not schedule');}});
  view.buildDemo(state);view.setAmbient(true,{reducedMotion:true});assert.equal(view.homeTime,SHOWCASE_SETTLED_SECONDS);assert.equal(view.stopped,true);
  const expected=showcasePose(SHOWCASE_SETTLED_SECONDS);assert.deepEqual(JSON.parse(view.renderer.domElement.dataset.demo).pose,expected);
  const oldLayer=view.demoLayer;view.buildDemo(state);assert.equal(oldLayer.children.length,0);assert.equal(oldLayer.parent,null);assert.deepEqual(JSON.parse(view.renderer.domElement.dataset.demo).pose,expected);
  view.clearDemo();assert.equal(scene.children.length,0);assert.equal(view.demoParts,null);assert.equal(view.demoLayer,null);assert.equal(view.renderer.domElement.dataset.demo,'none');assets.dispose();
});
