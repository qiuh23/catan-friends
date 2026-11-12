import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createBoard} from '../shared/board.js';
import {BoardAssets,Batches,clearLayer} from '../src/terrain.js';
import {addRoad} from '../src/pieces.js';
import {roadFrame,roadLampPose} from '../src/visuals/road-geometry.js';
import {createRoadLights} from '../src/visuals/road-lights.js';
import {createBoardEnvironment} from '../src/visuals/board-environment.js';
import {dayNightAt} from '../src/visuals/day-night.js';

function board(expanded=false){return createBoard(()=>.43,expanded?{playerExpansion:'five-six-2025'}:{});}
test('paved roads share geometry, preserve owner colours and stay inside the edge corridor',()=>{
  const assets=new BoardAssets(),batch=new Batches(assets),group=new THREE.Group();
  const a={x:0,z:0},b={x:1,z:0};addRoad(batch,a,b,'#dd5544');
  assert.equal([...batch.entries.values()].reduce((n,e)=>n+e.items.length,0),18);
  for(const entry of batch.entries.values())for(const item of entry.items){assert.ok(Math.abs(item.z)+item.sz/2<=.1001);assert.ok(item.x-item.sx/2>.08);assert.ok(item.x+item.sx/2<.92);assert.ok(item.y+item.sy/2<.36);}
  batch.finish(group);assert.equal(group.children.length,2);assert.ok(group.children.every(m=>m.isInstancedMesh));
  const reverse=new Batches(assets);addRoad(reverse,b,a,'#dd5544');assert.deepEqual(reverse.entries,batch.entries);
  assert.ok(batch.entries.get('pieces:paving').items.some(i=>i.color===new THREE.Color('#dd5544').offsetHSL(0,0,-.07).getHex()));
  clearLayer(group);assets.dispose();
});
test('every real board edge keeps lanterns away from intersections and inside shared edge clearance',()=>{
  for(const expanded of [false,true])for(const edge of board(expanded).edges){
    const b=board(expanded),a=b.vertices[edge.a],v=b.vertices[edge.b],pose=roadLampPose(a,v),f=roadFrame(a,v);
    const dx=pose.x-f.x,dz=pose.z-f.z;
    assert.ok(Math.abs(dx*(-f.dz)+dz*f.dx)+.039<.105);
    assert.ok(Math.hypot(pose.x-a.x,pose.z-a.z)>.35);assert.ok(Math.hypot(pose.x-v.x,pose.z-v.z)>.35);
    assert.deepEqual(roadLampPose(v,a),pose);
  }
});
test('only owned roads get lamps, all 109 edges use three batches and zero lights',()=>{
  const b=board(true),original=JSON.stringify(b),scene=new THREE.Scene(),lights=createRoadLights(scene);
  lights.setBoard(b);assert.equal(lights.getState().roads,0);assert.equal(JSON.stringify(b),original);
  for(const e of b.edges)e.owner='p0';const snapshot=JSON.stringify(b);lights.setBoard(b);
  assert.equal(lights.getState().roads,109);assert.equal(lights.group.children.length,3);
  assert.equal(lights.group.children.filter(c=>c.isLight).length,0);
  assert.ok(lights.group.children.every(c=>c.count===109&&!c.castShadow));assert.equal(JSON.stringify(b),snapshot);
  const ids=lights.group.children.map(c=>c.uuid);
  for(let i=0;i<20;i++)lights.setBoard(b);assert.deepEqual(lights.group.children.map(c=>c.uuid),ids);
  const hits=[];for(const c of lights.group.children)c.raycast(null,hits);assert.deepEqual(hits,[]);
  b.edges[0].owner=null;lights.setBoard(b);assert.equal(lights.getState().roads,108);assert.equal(lights.group.children.length,3);
  lights.dispose();lights.dispose();assert.equal(scene.children.length,0);
});
test('night glow fades continuously, respects low power, hides in daylight and keeps resources stable',()=>{
  const b=board();b.edges[0].owner='p0';const lights=createRoadLights(new THREE.Scene());lights.setBoard(b);
  const [frame,glass,pool]=lights.group.children,resources=lights.group.children.map(m=>[m.geometry.uuid,m.material.uuid]);
  lights.setNight(0);assert.equal(pool.visible,false);assert.equal(glass.material.emissiveIntensity,0);
  lights.setNight(.5);assert.equal(pool.visible,true);assert.equal(glass.material.emissiveIntensity,1.9);assert.equal(pool.material.uniforms.uNight.value,.5);
  lights.setNight(1,{lowPower:true});assert.equal(glass.material.emissiveIntensity,3.8);assert.equal(pool.material.uniforms.uStrength.value,.6);
  for(let t=0;t<720000;t+=100)lights.setNight(dayNightAt(t).night);
  assert.deepEqual(lights.group.children.map(m=>[m.geometry.uuid,m.material.uuid]),resources);
  const before=frame.instanceMatrix.version;lights.setReveal(new Map([[0,0]]));assert.ok(frame.instanceMatrix.version>before);
  const matrix=new THREE.Matrix4();frame.getMatrixAt(0,matrix);assert.equal(new THREE.Vector3().setFromMatrixScale(matrix).length(),0);
  lights.setReveal(new Map([[0,1]]));frame.getMatrixAt(0,matrix);assert.deepEqual(new THREE.Vector3().setFromMatrixScale(matrix).toArray().map(v=>Math.round(v)),[1,1,1]);
  const same=frame.instanceMatrix.version;lights.setReveal(new Map([[0,1]]));assert.equal(frame.instanceMatrix.version,same);
  lights.dispose();
});
test('manual preview and room time expose the same continuous night amount',()=>{
  const scene=new THREE.Scene(),sea=new THREE.Mesh(new THREE.CylinderGeometry(),new THREE.MeshBasicMaterial());
  const env=createBoardEnvironment({scene,camera:new THREE.PerspectiveCamera(),renderer:{shadowMap:{}},seaMesh:sea});
  env.setEnvironment({phase:'night',transitionSeconds:2});env.update(1);assert.equal(env.getState().night,.5);env.update(1);assert.equal(env.getState().night,1);
  env.setEnvironment({phase:'day',transitionSeconds:2});env.update(1);assert.equal(env.getState().night,.5);env.update(1);assert.equal(env.getState().night,0);
  for(const t of [0,120000,270000,360000]){env.setCycle(t);assert.equal(env.getState().night,dayNightAt(t).night);}
  env.dispose();sea.geometry.dispose();sea.material.dispose();
});
