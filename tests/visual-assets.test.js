import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {BoardModels,instanceMatrix,TERRAIN_URL,ARCHITECTURE_URL,buildingAsset} from '../src/visuals/board-models.js';
import {createBoardEnvironment} from '../src/visuals/board-environment.js';
import {chooseTerrainVariant,deriveTerrainAppearanceSeed,groupTerrainVariants} from '../src/visuals/vendor/terrain-variants.mjs';
import {BoardAssets,buildTerrain,clearLayer} from '../src/terrain.js';
import {createBoard} from '../shared/board.js';

const manifest=JSON.parse(await readFile(new URL('../public/assets/v9/catan/variants/manifest.json',import.meta.url),'utf8'));
const architecture=JSON.parse(await readFile(new URL('../docs/visuals/architecture-source-manifest.json',import.meta.url),'utf8'));
async function parse(url){const bytes=await readFile(new URL(`../public${url}`,import.meta.url));return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');}
class LocalLoader{loadAsync(url){return parse(url);}}
const randomFor=initial=>{let seed=initial;return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};

// Parse the actual production GLBs, not a fixture that merely resembles them.
test('all 17 terrain assets retain source hashes, vertex colors and PBR',async()=>{
  assert.equal(manifest.assets.length,17);
  assert.equal((await readdir(new URL(`../public${TERRAIN_URL}`,import.meta.url))).length,17);
  for(const asset of manifest.assets){
    const url=TERRAIN_URL+asset.id+'.glb',bytes=await readFile(new URL(`../public${url}`,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
    const {scene}=await parse(url);let meshes=0;
    scene.traverse(o=>{if(!o.isMesh)return;meshes++;assert.ok(o.geometry.attributes.color);assert.ok(Math.abs(o.material.roughness-.72)<1e-6);assert.equal(o.material.vertexColors,true);o.geometry.dispose();o.material.dispose();});
    assert.equal(meshes,asset.primitives);
  }
});
test('five runtime architecture assets match source hashes',async()=>{
  const files=await readdir(new URL(`../public${ARCHITECTURE_URL}`,import.meta.url));assert.equal(files.length,5);
  for(const file of files){const asset=architecture.assets.find(a=>a.file==='models/'+file),bytes=await readFile(new URL(`../public${ARCHITECTURE_URL}${file}`,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);}
});
test('19/30 tiles and shuffled tile order keep cosmetic choices stable without changing state',()=>{
  const seen=new Set(),layouts=new Set();
  for(const expansion of [false,true])for(let seed=1;seed<=20;seed++){
    const board=createBoard(randomFor(seed),expansion?{playerExpansion:'five-six-2025'}:{});
    assert.equal(board.tiles.length,expansion?30:19);
    const before=JSON.stringify(board),key=deriveTerrainAppearanceSeed(board),reordered={...board,tiles:[...board.tiles].reverse()};
    assert.equal(key,deriveTerrainAppearanceSeed(reordered));
    const choices=board.tiles.map(tile=>chooseTerrainVariant(tile,{seed:key,baseURL:TERRAIN_URL}));
    for(const c of choices)seen.add(c.asset);
    const byId=new Map(board.tiles.map((tile,i)=>[tile.id,choices[i]]));
    for(const tile of reordered.tiles)assert.deepEqual(chooseTerrainVariant(tile,{seed:key,baseURL:TERRAIN_URL}),byId.get(tile.id));
    for(const group of groupTerrainVariants(board.tiles,{seed:key}))assert.ok(group.instances.every(i=>i.rotationY>=0&&i.rotationY<2*Math.PI));
    assert.equal(JSON.stringify(board),before);layouts.add(choices.map(c=>c.asset+':'+c.rotationSteps).join(','));
  }
  assert.equal(seen.size,17);assert.ok(layouts.size>20);
});
test('instance matrices retain each tile rotation and direct raycast parents',async()=>{
  const models=new BoardModels({Loader:LocalLoader}),board=createBoard(randomFor(17));await models.prepare(board);
  const layer=new THREE.Group(),loaded=models.terrain(board,layer);assert.equal(loaded.size,19);
  for(const group of models.choices(board))for(const mesh of layer.children.filter(m=>m.userData.tileIds?.[0]===group.instances[0].tileId))for(let i=0;i<group.instances.length;i++){
    const matrix=new THREE.Matrix4();mesh.getMatrixAt(i,matrix);assert.ok(matrix.elements.every((n,j)=>Math.abs(n-instanceMatrix(group.instances[i]).elements[j])<1e-6));assert.equal(mesh.parent,layer);assert.ok(mesh.boundingSphere);}
  models.releaseLayer(layer);assert.equal(layer.children.length,0);await models.dispose();
});
test('building owner tint is per instance and never mutates cached source materials',async()=>{
  const models=new BoardModels({Loader:LocalLoader}),board=createBoard(randomFor(5));await models.prepare(board);
  const layer=new THREE.Group(),vertices=[{id:0,x:0,z:0,owner:'a',level:1},{id:2,x:1,z:0,owner:'b',level:1}];
  // Force both instances into the same selected model to verify instance colours.
  while(buildingAsset(vertices[1])!==buildingAsset(vertices[0]))vertices[1].id++;
  await models.load(ARCHITECTURE_URL+buildingAsset(vertices[0])+'.glb');
  const source=models.ready.get(ARCHITECTURE_URL+buildingAsset(vertices[0])+'.glb'),owner=[];source.traverse(m=>{if(m.material?.name==='OwnerTint')owner.push([m.material,m.material.color.clone()]);});
  models.buildings(vertices,id=>id==='a'?'#ff0000':'#0000ff',layer);
  const tinted=layer.children.find(m=>m.material.name==='OwnerTint');assert.ok(tinted);assert.equal(tinted.count,2);
  const color=new THREE.Color();tinted.getColorAt(0,color);assert.equal(color.getHex(),0xff0000);tinted.getColorAt(1,color);assert.equal(color.getHex(),0x0000ff);
  for(const [material,original]of owner)assert.ok(material.color.equals(original));
  models.releaseLayer(layer);await models.dispose();
});
test('failed loads retain procedural terrain and do not create retry loops',async()=>{
  let calls=0;class Failure{async loadAsync(){calls++;throw new Error('fixture 404');}}
  const models=new BoardModels({Loader:Failure}),board=createBoard(randomFor(3)),layer=new THREE.Group(),assets=new BoardAssets();
  const result=await models.prepare(board);assert.equal(result.loaded,0);const loaded=models.terrain(board,layer);assert.equal(loaded.size,0);
  buildTerrain(board,assets,layer,{loadedTiles:loaded,loadedPorts:models.ports(board,layer)});assert.ok(layer.children.length>0);
  await models.prepare(board);assert.equal(calls,result.requested);clearLayer(layer);assets.dispose();await models.dispose();
});
test('late loading disposal is idempotent and separate boards do not share disposal',async()=>{
  let finish;const geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),scene=new THREE.Group();scene.add(new THREE.Mesh(geometry,material));
  let geometries=0,materials=0;geometry.addEventListener('dispose',()=>geometries++);material.addEventListener('dispose',()=>materials++);
  class Pending{loadAsync(){return new Promise(resolve=>{finish=resolve;});}}
  const models=new BoardModels({Loader:Pending}),request=models.load('late.glb'),disposal=models.dispose();finish({scene});await request;await disposal;await models.dispose();assert.equal(geometries,1);assert.equal(materials,1);assert.equal(models.ready.size,0);
});
test('one explicit day/dusk/night state drives lighting, sky and sea with finite transitions',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.1,150),renderer={shadowMap:{},toneMapping:0,toneMappingExposure:1,outputColorSpace:THREE.SRGBColorSpace};
  camera.position.set(14,8,.3);camera.lookAt(0,0,0);
  const previous=new THREE.MeshBasicMaterial(),seaMesh=new THREE.Mesh(new THREE.CylinderGeometry(),previous);scene.add(seaMesh);
  const environment=createBoardEnvironment({scene,camera,renderer,seaMesh});
  for(const weather of ['clear','overcast'])for(const phase of ['day','dusk','night']){
    environment.setEnvironment({phase,weather});assert.equal(environment.getState().phase,phase);assert.equal(environment.lighting.getState().weather,weather);assert.equal(environment.sky.getState().to,phase);
    assert.ok(environment.sky.getLightingState().direction.distanceTo(environment.lighting.getLightingState().direction)<1e-9);assert.equal(environment.sky.uniforms.uNight.value,phase==='night'?1:phase==='dusk'?.12:0);assert.equal(renderer.toneMappingExposure,1);
  }
  environment.setEnvironment({phase:'day'});environment.setEnvironment({phase:'night',transitionSeconds:1});assert.equal(environment.update(.5),true);assert.equal(environment.sky.uniforms.uNight.value,.5);assert.equal(environment.update(.5),false);assert.equal(environment.update(.5),false);
  environment.setEnvironment({phase:'day',transitionSeconds:2});environment.update(0,true);assert.equal(environment.getState().phase,'day');assert.equal(environment.getState().transitionActive,false);
  environment.setQuality({lowPower:true});assert.equal(renderer.shadowMap.enabled,false);assert.equal(environment.sky.getState().lowQuality,true);environment.setQuality({});assert.equal(renderer.shadowMap.enabled,true);
  assert.throws(()=>environment.setEnvironment({phase:'rain'}),RangeError);
  environment.dispose();environment.dispose();assert.equal(seaMesh.material,previous);assert.equal(scene.children.filter(o=>o.isLight).length,0);seaMesh.geometry.dispose();previous.dispose();
});

test('all four real building GLBs expose warm windows without recolouring owners',async()=>{
  const models=new BoardModels({Loader:LocalLoader}),board=createBoard(randomFor(7));await models.prepare(board);
  await Promise.all(['village_timber','village_dormer','city_citadel','city_clockhall'].map(name=>models.load(ARCHITECTURE_URL+name+'.glb')));
  models.setNight(.75);
  for(const name of ['village_timber','village_dormer','city_citadel','city_clockhall']){
    const source=models.ready.get(ARCHITECTURE_URL+name+'.glb');let windows=0,patched=0;
    source.traverse(mesh=>{
      if(!mesh.isMesh)return;const colors=mesh.geometry.attributes.color;
      for(let i=0;i<(colors?.count||0);i++)if(Math.abs(colors.getX(i)-.019)<.004&&Math.abs(colors.getY(i)-.058)<.004&&Math.abs(colors.getZ(i)-.068)<.004)windows++;
      if(mesh.material.name==='OwnerTint')assert.notEqual(mesh.material.customProgramCacheKey(),'catan-warm-windows-v1');
      else if(mesh.material.customProgramCacheKey()==='catan-warm-windows-v1'){
        patched++;const shader={uniforms:{},fragmentShader:'#include <emissivemap_fragment>'};mesh.material.onBeforeCompile(shader);
        assert.equal(shader.uniforms.uWindowNight,models.nightUniform);assert.match(shader.fragmentShader,/totalEmissiveRadiance/);
      }
    });
    assert.ok(windows>0,`${name} has no window mask vertices`);assert.ok(patched>0);
  }
  await models.dispose();assert.equal(models.windowMaterials.size,0);
});

test('approved relief stays within the measured 19/30-hex geometry and download budget',()=>{
  const assets=new Map(manifest.assets.map(a=>[a.id,a]));
  for(const expanded of [false,true])for(let seed=1;seed<=100;seed++){
    const board=createBoard(randomFor(seed),expanded?{playerExpansion:'five-six-2025'}:{});
    const groups=groupTerrainVariants(board.tiles,{seed:deriveTerrainAppearanceSeed(board)});
    let triangles=0,bytes=0,parts=0;
    for(const group of groups){const asset=assets.get(group.url.split('/').at(-1).replace('.glb',''));triangles+=asset.triangles*group.instances.length;bytes+=asset.bytes;parts+=asset.primitives;}
    assert.ok(triangles<=(expanded?450000:285000));assert.ok(bytes<=13100000);assert.ok(parts<=34);
  }
});
