import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {BoardModels,TERRAIN_URL} from '../src/visuals/board-models.js';
import {ROBBER_URL,robberSupport,createRobberHighlight} from '../src/visuals/robber.js';
import {ROBBER_SUPPORT} from '../src/visuals/robber-support-data.js';
import {BoardAssets} from '../src/terrain.js';
import {createBoard} from '../shared/board.js';
const parse=async url=>{const b=await readFile(new URL('../public'+url,import.meta.url));return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');};
class Loader{loadAsync(url){return parse(url);}}

test('approved hooded robber retains original mesh, vertex colours, foot origin and mobile budget',async()=>{
  const bytes=await readFile(new URL('../public'+ROBBER_URL,import.meta.url)),manifest=JSON.parse(await readFile(new URL('../public/assets/v9/catan_robber/manifest.json',import.meta.url)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
  const gltf=await parse(ROBBER_URL);let meshes=0,triangles=0;
  gltf.scene.traverse(mesh=>{if(!mesh.isMesh)return;meshes++;triangles+=(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3;assert.ok(mesh.geometry.attributes.color);assert.ok(mesh.material.vertexColors);});
  assert.equal(meshes,1);assert.equal(triangles,1763);assert.equal(gltf.animations.length,0);assert.ok(bytes.length<140000);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(gltf.scene).min.y)<1e-6);
});
test('all 17 relief variants at all six rotations have finite grounded robber placement without scenery above its feet',async()=>{
  const files=await readdir(new URL('../public'+TERRAIN_URL,import.meta.url));let maxSpread=0,maxObstruction=0;
  for(const file of files){const {scene}=await parse(TERRAIN_URL+file),baked=ROBBER_SUPPORT[file.replace('.glb','')];
    const bytes=await readFile(new URL('../public'+TERRAIN_URL+file,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),baked.sha256);
    for(let i=0;i<6;i++){
      const pose=robberSupport(scene,i*Math.PI/3);assert.deepEqual(pose,baked.poses[i]);
      assert.ok(Object.values(pose).every(Number.isFinite),file);
      assert.ok(Math.abs(Math.hypot(pose.x,pose.z)-.4)<1e-6);assert.ok(pose.y>=.25&&pose.y<=.6,`${file}: height ${pose.y}`);
      maxSpread=Math.max(maxSpread,pose.spread);maxObstruction=Math.max(maxObstruction,pose.obstruction);
      assert.ok(pose.obstruction<.025,`${file} rotation ${i}: scenery overlap ${pose.obstruction}`);
      assert.ok(pose.spread<.075,`${file} rotation ${i}: ground spread ${pose.spread}`);
    }
  }
  console.log('Robber support diagnostics',JSON.stringify({variants:files.length,rotations:6,maxSpread,maxObstruction}));
});
test('robber follows authoritative tile, modest rim stays on its own material, highlight is depth-tested and resources dispose',async()=>{
  const models=new BoardModels({Loader}),board=createBoard(()=>.43),layer=new THREE.Group(),assets=new BoardAssets();await models.prepare(board,{robber:true});
  for(const id of [0,board.tiles.length-1]){
    models.releaseLayer(layer);layer.clear();const tile=board.tiles[id],pose=models.robber(board,tile,layer);
    assert.equal(pose.loaded,true);assert.equal(layer.children.length,1);
    const matrix=new THREE.Matrix4();layer.children[0].getMatrixAt(0,matrix);
    assert.ok(Math.abs(matrix.elements[12]-tile.x-pose.x)<1e-6);assert.ok(Math.abs(matrix.elements[14]-tile.z-pose.z)<1e-6);
    const material=layer.children[0].material,shader={uniforms:{},fragmentShader:'#include <emissivemap_fragment>'};material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uRobberNight,models.nightUniform);assert.match(shader.fragmentShader,/robberRim/);
    const ring=createRobberHighlight(assets,pose,tile);assert.equal(ring.material.depthTest,true);assert.equal(ring.material.depthWrite,false);assert.equal(ring.castShadow,false);assert.equal(ring.isLight,undefined);
  }
  await models.dispose();assets.dispose();assert.equal(models.robberMaterials.size,0);assert.equal(models.robberPlacements.size,0);
});
test('missing robber or terrain keeps a finite procedural fallback without retries',async()=>{
  class Missing{async loadAsync(){throw Error('fixture missing');}}
  const models=new BoardModels({Loader:Missing}),board=createBoard(()=>.43);await models.prepare(board,{robber:true});
  const layer=new THREE.Group(),pose=models.robber(board,board.tiles[0],layer);assert.equal(pose.loaded,false);assert.equal(pose.y,.33);assert.equal(layer.children.length,0);await models.dispose();
});
