import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {BoardModels,TERRAIN_URL,ARCHITECTURE_URL,buildingAsset} from '../src/visuals/board-models.js';
import {createModelByteCache} from '../src/visuals/model-byte-cache.js';
import {ProgressiveTerrain} from '../src/visuals/progressive-terrain.js';
import {BoardAssets,clearLayer} from '../src/terrain.js';
import {createBoard} from '../shared/board.js';
import {ROBBER_URL} from '../src/visuals/robber.js';
const board=()=>{let seed=17;return createBoard(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;});};
const scene=()=>{const group=new THREE.Group();group.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));return {scene:group};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('only board terrain, actual buildings, ports and a present robber are required',()=>{
  const models=new BoardModels(),b=board(),empty=models.required(b);
  assert.ok(empty.some(u=>u.startsWith(TERRAIN_URL)));assert.equal(empty.filter(u=>u.startsWith(ARCHITECTURE_URL)).length,1);assert.ok(!empty.includes(ROBBER_URL));
  b.vertices[0].owner='a';b.vertices[0].level=1;
  const occupied=models.required(b,{robber:true});assert.ok(occupied.includes(ARCHITECTURE_URL+buildingAsset(b.vertices[0])+'.glb'));assert.ok(occupied.includes(ROBBER_URL));
  assert.equal(occupied.length,empty.length+2);
  const home=models.required(b,{homeDemo:{buildings:[{vertex:0,buildAt:1,upgradeAt:10}]}});assert.equal(home.filter(u=>u.startsWith(ARCHITECTURE_URL)).length,3);assert.ok(!home.includes(ROBBER_URL));
});
test('four load slots, early progress, request deduplication and explicit retry',async()=>{
  const pending=[],calls=[];class Loader{loadAsync(url){calls.push(url);return new Promise((resolve,reject)=>pending.push({url,resolve,reject}));}}
  const models=new BoardModels({Loader}),b=board(),updates=[],promise=models.prepare(b,{onAsset:(url,ok)=>updates.push({url,ok})});
  assert.equal(calls.length,4);assert.ok(calls.every(u=>u.startsWith(TERRAIN_URL)));
  pending.shift().resolve(scene());await turn();assert.equal(updates.length,1);assert.equal(calls.length,5);
  let failed;while(pending.length){const item=pending.shift();if(!failed){failed=item.url;item.reject(new Error('fixture'));}else item.resolve(scene());await turn();}
  const result=await promise;assert.deepEqual(result.failed,[failed]);const total=calls.length;
  await models.prepare(b);assert.equal(calls.length,total);
  models.retryFailed();const retry=models.prepare(b);assert.equal(calls.length,total+1);pending.shift().resolve(scene());await retry;assert.equal(models.failed.size,0);await models.dispose();
});
test('byte cache coalesces requests, bounds memory, expires and does not cache failures',async()=>{
  let count=0,time=0;const cache=createModelByteCache({maxBytes:12,ttlMs:10,now:()=>time,fetcher:async()=>{count++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};}});
  const [a,b]=await Promise.all([cache.load('/a'),cache.load('/a')]);assert.equal(a,b);assert.equal(count,1);
  await cache.load('/b');assert.equal(cache.stats().bytes,8);await cache.load('/a');assert.equal(count,3);
  time=20;await cache.load('/a');assert.equal(count,4);
  let failure=0;const bad=createModelByteCache({fetcher:async()=>{failure++;throw new Error('offline');}});
  await assert.rejects(bad.load('/bad'));await assert.rejects(bad.load('/bad'));assert.equal(failure,2);assert.equal(bad.stats().bytes,0);
});
test('timed-out downloads abort and can be retried',async()=>{
  let aborts=0;const cache=createModelByteCache({timeoutMs:5,fetcher:(_,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{aborts++;reject(new Error('timeout'));}))});
  await assert.rejects(cache.load('/stuck'));await assert.rejects(cache.load('/stuck'));assert.equal(aborts,2);assert.equal(cache.stats().entries,0);
});
test('progressive terrain preserves other mesh identities and releases transition resources',async()=>{
  const models=new BoardModels({Loader:class{async loadAsync(){return scene();}}}),assets=new BoardAssets(),land=new THREE.Group(),p=new ProgressiveTerrain(models,assets,land),b=board();
  p.reset(b);assert.equal(p.stats().tiles,0);const entries=[...p.parts],url=entries[0][0],untouched=entries[1][1].placeholder.nodes[0];
  // Placeholder is only three base hexes per tile, never procedural trees/rocks.
  assert.ok([...p.parts.values()].filter(x=>x.tiles).every(x=>x.placeholder.nodes.length===1));
  await models.load(url);p.update({now:10});assert.ok(p.stats().tiles>0);assert.equal(untouched.parent,land);assert.equal(p.fades.length,1);
  const fading=p.fades[0].materials[0];let released=0;fading.fade.addEventListener('dispose',()=>released++);
  assert.equal(p.tick(130),true);assert.ok(fading.fade.opacity>0&&fading.fade.opacity<1);assert.equal(p.tick(250),false);assert.equal(released,1);assert.equal(fading.mesh.material,fading.original);
  const stable=[...land.children];assert.equal(p.update(),false);assert.deepEqual(land.children,stable);
  p.dispose();assert.equal(land.children.length,0);assert.equal(models.layers.size,0);clearLayer(land);assets.dispose();await models.dispose();
});
test('failed terrain uses functional fallback once; retry upgrades only that family',async()=>{
  const models=new BoardModels(),assets=new BoardAssets(),land=new THREE.Group(),p=new ProgressiveTerrain(models,assets,land);p.reset(board());
  const url=[...p.parts.keys()][0];models.failed.add(url);p.update({reducedMotion:true});assert.equal(p.parts.get(url).status,'failed');const fallback=p.parts.get(url).display.nodes;
  assert.ok(fallback.length>1);assert.equal(p.fades.length,0);assert.equal(p.update(),false);
  models.failed.clear();models.ready.set(url,scene().scene);p.update({reducedMotion:true});assert.equal(p.parts.get(url).status,'ready');assert.ok(fallback.every(mesh=>!mesh.parent));
  p.dispose();assets.dispose();await models.dispose();
});
test('disposing a board rejects queued loads and late results never notify it',async()=>{
  const pending=[];class Loader{loadAsync(){return new Promise(resolve=>pending.push(resolve));}}
  const models=new BoardModels({Loader});let updates=0;const request=models.prepare(board(),{onAsset:()=>updates++}),disposal=models.dispose();
  for(const finish of pending)finish(scene());await request;await disposal;assert.equal(updates,0);assert.equal(models.ready.size,0);assert.equal(models.pending.length,0);
});

test('a new map drops obsolete queued models and prioritizes its current assets',async()=>{
  const pending=[],calls=[];class Loader{loadAsync(url){calls.push(url);return new Promise(resolve=>pending.push(resolve));}}
  const models=new BoardModels({Loader});models.choices=b=>b.urls.map(url=>({url,instances:[{}]}));
  const old=models.prepare({urls:['/a','/b','/c','/d','/obsolete'],vertices:[],ports:[]});
  const current=models.prepare({urls:['/current'],vertices:[],ports:[]});
  for(const resolve of pending.splice(0))resolve(scene());await turn();assert.ok(calls.includes('/current'));assert.ok(!calls.includes('/obsolete'));
  for(const resolve of pending.splice(0))resolve(scene());await current;await old;assert.equal(models.failed.has('/obsolete'),false);await models.dispose();
});

test('Board ignores old-map and disposed completions without resetting the current scene',async()=>{
  const {Board}=await import('../src/board3d.js');const jobs=[],canvas={dataset:{}};
  const fake={models:{required:b=>b.urls,prepare:(b,options)=>new Promise(resolve=>jobs.push({options,resolve})),choices:()=>[]},renderer:{domElement:canvas},invalidate(){this.invalidations=(this.invalidations||0)+1;},disposed:false};
  const a={board:{urls:['a']},robber:null},b={board:{urls:['b']},robber:null};
  Board.prototype.requestModels.call(fake,a,'a');Board.prototype.requestModels.call(fake,b,'b');
  fake.modelsDirty=false;const prior=fake.invalidations;
  jobs[0].options.onAsset('a',true);jobs[0].resolve({requested:1,loaded:1,failed:[]});await turn();assert.equal(fake.modelsDirty,false);assert.equal(fake.invalidations,prior);assert.equal(canvas.dataset.modelLoad,undefined);
  jobs[1].options.onAsset('b',true);jobs[1].resolve({requested:1,loaded:1,failed:[]});await turn();assert.equal(fake.modelsDirty,true);assert.equal(JSON.parse(canvas.dataset.modelLoad).loaded,1);
  Board.prototype.requestModels.call(fake,a,'a');fake.disposed=true;fake.modelsDirty=false;jobs[2].options.onAsset('a',true);jobs[2].resolve({requested:1,loaded:1,failed:[]});await turn();assert.equal(fake.modelsDirty,false);
});
