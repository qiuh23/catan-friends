import test from 'node:test';
import assert from 'node:assert/strict';
import {Room} from '../shared/room.js';
import {createRoomFromInput} from '../shared/room-create.js';
import {GAME_DAY_MS,projectSceneClock,updateSceneClock} from '../shared/scene-clock.js';
import {dayNightAt,SceneClock} from '../src/visuals/day-night.js';
import * as THREE from 'three';
import {createBoardEnvironment} from '../src/visuals/board-environment.js';
const at=1_000_000;
const send=(room,id,action,now)=>room.handle(id,{id:crypto.randomUUID(),revision:room.record.revision,action},now);
async function playing(){const room=await createRoomFromInput({token:crypto.randomUUID(),name:'房主'},at),host=room.record.hostId,guest=room.join('guest','朋友',at);send(room,host,{type:'addBot'},at);send(room,guest,{type:'ready'},at);room.presence([host,guest],at);send(room,host,{type:'start'},at);return {room,host,guest};}
test('actual start, pause/resume, offline, restore and rematch own one public clock',async()=>{
  const {room,host,guest}=await playing();
  const clock=(r=room,t=at)=>r.snapshot(host,[host,guest],t).state.room.sceneClock;
  assert.deepEqual(clock(),{elapsedMs:0,sampledAt:at,running:true});
  assert.deepEqual(clock(room,at+180000),room.snapshot(guest,[host,guest],at+180000).state.room.sceneClock);
  send(room,host,{type:'pause'},at+180000);assert.equal(clock(room,at+400000).elapsedMs,180000);assert.equal(clock().running,false);
  send(room,host,{type:'resume'},at+400000);assert.equal(clock(room,at+410000).elapsedMs,190000);
  room.presence([guest],at+410000);assert.equal(clock().running,true,'host departure must not pause peers');
  room.presence([],at+420000);assert.equal(clock(room,at+430000).elapsedMs,200000);
  const restored=new Room(structuredClone(room.record),at+450000);restored.presence([host],at+450000);assert.equal(clock(restored,at+460000).elapsedMs,210000);
  restored.record.game.phase='finished';updateSceneClock(restored.record,at+460000,[host]);assert.equal(clock(restored,at+480000).elapsedMs,210000);
  send(restored,host,{type:'rematch'},at+480000);assert.equal(clock(restored,at+490000).elapsedMs,0);assert.equal(clock(restored).running,false);
  assert.ok(!('sceneClock'in restored.record.game),'visual clock must not affect rules/random state');
});
test('server restart recovery excludes downtime; legacy saves migrate without touching game data',async()=>{
  const {room,host}=await playing();room.presence([host],at+5000);
  const restarted=new Room(structuredClone(room.record),at+20000);restarted.presence([],at+20000,true);
  assert.equal(projectSceneClock(restarted.record,at+30000).elapsedMs,5000);
  const legacy=structuredClone(room.record);delete legacy.sceneClock;legacy.game.turnNo=9;const before=JSON.stringify(legacy.game);
  const migrated=new Room(legacy,at+5000);assert.equal(JSON.stringify(migrated.record.game),before);assert.equal(projectSceneClock(migrated.record,at+5000).elapsedMs,120000);
});
test('duplicate/rejected commands and chat never advance the room visual state',async()=>{
  const {room,host}=await playing();const command={id:crypto.randomUUID(),revision:room.record.revision,action:{type:'pause'}};
  room.handle(host,command,at+5000);const before=structuredClone(room.record.sceneClock);
  room.handle(host,command,at+6000);assert.deepEqual(room.record.sceneClock,before);
  assert.throws(()=>send(room,host,{type:'roll'},at+7000));assert.deepEqual(room.record.sceneClock,before);
  send(room,host,{type:'chat',text:'hello'},at+8000);assert.deepEqual(room.record.sceneClock,before);
});
test('finite continuous appearance includes an obvious dusk and night during a short game',()=>{
  assert.equal(dayNightAt(60000).to,'day');assert.equal(dayNightAt(270000).to,'dusk');assert.equal(dayNightAt(360000).night,1);
  for(let t=0;t<=GAME_DAY_MS;t+=100){const a=dayNightAt(t),b=dayNightAt(t+.1);assert.ok(a.direction.every(Number.isFinite));for(const body of ['sun','moon'])for(const key of ['x','y','opacity'])assert.ok(Math.abs(a[body][key]-b[body][key])<.0001);}
  assert.deepEqual(dayNightAt(0),dayNightAt(GAME_DAY_MS));
});
test('client anchors ignore UI rerenders and local wall-clock differences; pause is exact',()=>{
  const a=new SceneClock(),b=new SceneClock(),sample={elapsedMs:100000,sampledAt:at,running:true};
  a.receive(sample,100);b.receive(sample,10000);assert.equal(a.elapsed(500),b.elapsed(10400));a.receive(sample,500);assert.equal(a.elapsed(600),100500);
  a.receive({...sample,elapsedMs:101000,running:false},600);assert.equal(a.elapsed(600000),101000);
});
test('absolute cycle drives the same sky/light direction without adding lights or allocations',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),renderer={shadowMap:{}},seaMesh=new THREE.Mesh(new THREE.CylinderGeometry(),new THREE.MeshBasicMaterial());
  const environment=createBoardEnvironment({scene,camera,renderer,seaMesh});const originalChildren=scene.children.length,positions=[];
  for(let t=0;t<GAME_DAY_MS;t+=1000){
    renderer.shadowMap.needsUpdate=false;environment.setCycle(t);
    const expected=new THREE.Vector3(...dayNightAt(t).direction).normalize(),sun=environment.lighting.sun;
    assert.ok(environment.sky.getLightingState().direction.distanceTo(expected)<1e-9);
    assert.ok(sun.position.clone().sub(sun.target.position).normalize().distanceTo(expected)<1e-9);
    assert.equal(renderer.shadowMap.needsUpdate,true,'moving directional light must refresh cached shadows');
    assert.equal(sun.castShadow,true);positions.push(sun.position.toArray());
  }
  assert.notDeepEqual(positions[0],positions[120]);
  environment.setQuality({mobile:true});environment.setCycle(200000);assert.equal(renderer.shadowMap.enabled,false);
  environment.setQuality({});environment.setCycle(210000);assert.equal(renderer.shadowMap.enabled,true);
  assert.equal(scene.children.length,originalChildren);assert.equal(environment.sky.uniforms.uOrbit.value,1);
  environment.dispose();seaMesh.geometry.dispose();seaMesh.material.dispose();
});

test('real manual-input handler only yields the camera and preserves scene/demo scheduling',async()=>{
  const {Board}=await import('../src/board3d.js');let follows=0;
  const board={sceneTimer:41,ambientTimer:42,homeTime:12,homeSceneElapsed:44000,sceneClock:new SceneClock(),renderer:{domElement:{dataset:{}}},controls:{},reducedMotion:false,cancelFocus(){follows++;},onManual(){follows++;}};
  board.sceneClock.receive({elapsedMs:123000,sampledAt:at,running:true},100);
  Board.prototype.manualInput.call(board);
  assert.equal(board.sceneTimer,41);assert.equal(board.ambientTimer,42);assert.equal(board.homeTime,12);assert.equal(board.homeSceneElapsed,44000);assert.equal(board.sceneClock.elapsed(200),123100);assert.equal(board.ambientInterrupted,true);assert.equal(board.viewMode,'manual');assert.equal(follows,2);
});
