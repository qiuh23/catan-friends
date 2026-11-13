import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createBoard} from '../shared/board.js';
import {AnimationStutterMonitor,createQualityPreference,QUALITY_KEY,QUALITY_HINT_KEY} from '../src/graphics-quality.js';
import {createBoardEnvironment} from '../src/visuals/board-environment.js';
import {createNightLights} from '../src/visuals/night-lights.js';
import {Board} from '../src/board3d.js';
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
test('high is the default; only valid explicit choices persist and suppress suggestions',()=>{
  const s=storage(),p=createQualityPreference(s);assert.equal(p.value,'high');assert.equal(p.canSuggest,true);
  p.choose('low');assert.equal(s.getItem(QUALITY_KEY),'low');assert.equal(createQualityPreference(s).value,'low');assert.equal(p.canSuggest,false);
  p.choose('high');assert.equal(createQualityPreference(s).value,'high');assert.equal(createQualityPreference(s).canSuggest,false);
  s.setItem(QUALITY_KEY,'automatic');assert.equal(createQualityPreference(s).value,'high');assert.equal(createQualityPreference(s).canSuggest,true);
});
test('showing once is durable across reloads and does not change high quality',()=>{
  const s=storage(),p=createQualityPreference(s);p.markShown();assert.equal(p.value,'high');assert.equal(p.canSuggest,false);assert.equal(s.getItem(QUALITY_HINT_KEY),'1');
  const reloaded=createQualityPreference(s);assert.equal(reloaded.canSuggest,false);assert.equal(reloaded.value,'high');assert.equal(s.getItem(QUALITY_KEY),null);
});
test('unavailable storage keeps choices and once-only status in this page without throwing',()=>{
  const p=createQualityPreference({getItem(){throw Error('blocked');},setItem(){throw Error('quota');}});
  p.markShown();assert.equal(p.canSuggest,false);assert.equal(p.value,'high');p.choose('low');assert.equal(p.value,'low');
  assert.equal(createQualityPreference().value,'high');
});
function frames(m,{start=3000,duration=7500,step=120,...sample}={}){let hints=0;for(let now=start;now<=start+duration;now+=step)if(m.sample(now,{active:true,targetMs:1000/60,...sample}))hints++;return hints;}
test('intentional 20/24/30/60Hz animation is never mistaken for slow animation',()=>{
  for(const hz of [20,24,30,60]){const m=new AnimationStutterMonitor();assert.equal(frames(m,{duration:30000,step:1000/hz,targetMs:1000/hz}),0);}
});
test('three consecutive slow windows suggest; transient spikes and interrupted windows do not',()=>{
  for(const hz of [20,24,30,60])assert.equal(frames(new AnimationStutterMonitor(),{targetMs:1000/hz}),1);
  assert.equal(frames(new AnimationStutterMonitor(),{duration:5000}),0);
  const m=new AnimationStutterMonitor();frames(m,{duration:4400});m.suspend(7500);assert.equal(frames(m,{start:10000,duration:4400}),0);
  const mixed=new AnimationStutterMonitor();frames(mixed,{duration:4400});frames(mixed,{start:7440,duration:2500,step:1000/60});assert.equal(frames(mixed,{start:10000,duration:4400}),0);
});
test('idle, loading, blur/background, resize cooldown and suspension gaps never provide evidence',()=>{
  for(const flags of [{active:false},{foreground:false},{settled:false}])assert.equal(frames(new AnimationStutterMonitor(),{duration:30000,...flags}),0);
  const m=new AnimationStutterMonitor();frames(m,{duration:4400});assert.equal(m.sample(20000,{active:true}),false);assert.equal(frames(m,{start:22500,duration:4400}),0);
  m.suspend(30000);assert.equal(frames(m,{start:30000,duration:2000}),0);
});
test('mobile keeps full sky, shadows and harbour lights until the player selects low',()=>{
  const scene=new THREE.Scene(),renderer={shadowMap:{}},seaMesh=new THREE.Mesh(new THREE.CylinderGeometry(),new THREE.MeshBasicMaterial());
  const env=createBoardEnvironment({scene,camera:new THREE.PerspectiveCamera(),renderer,seaMesh});
  env.setQuality({mobile:true});assert.equal(renderer.shadowMap.enabled,true);assert.equal(env.sky.getState().lowQuality,false);
  const lanterns=createNightLights(scene);lanterns.setBoard(createBoard(()=>.43));lanterns.setNight(1,{mobile:true});
  const lights=[];scene.traverse(o=>{if(o.isPointLight)lights.push(o);});assert.equal(lights.length,2);assert.ok(lights.every(l=>l.intensity>0));
  env.setQuality({lowPower:true});lanterns.setNight(1,{lowPower:true});assert.equal(renderer.shadowMap.enabled,false);assert.ok(lights.every(l=>l.intensity===0));
  env.setQuality({});lanterns.setNight(1,{});assert.equal(renderer.shadowMap.enabled,true);assert.ok(lights.every(l=>l.intensity>0));
  lanterns.dispose();env.dispose();seaMesh.geometry.dispose();seaMesh.material.dispose();
});
test('quality switching reuses the board and does not mutate the player camera',()=>{
  const b={quality:'high',lowPower:false,stutter:new AnimationStutterMonitor(),camera:{view:'manual'},resize(){this.resized=(this.resized||0)+1;}};
  Board.prototype.setQuality.call(b,{quality:'low'});assert.equal(b.lowPower,true);assert.equal(b.quality,'low');
  Board.prototype.setQuality.call(b,{quality:'high'});assert.equal(b.lowPower,false);assert.equal(b.camera.view,'manual');assert.equal(b.resized,2);
});

test('an already open tab respects a choice or shown marker written by another tab',()=>{
  const s=storage(),first=createQualityPreference(s),second=createQualityPreference(s);
  first.markShown();assert.equal(second.canSuggest,false);
  const other=storage(),a=createQualityPreference(other),b=createQualityPreference(other);a.choose('high');assert.equal(b.canSuggest,false);
});

test('changing intended cadence starts fresh evidence rather than joining unrelated windows',()=>{
  const m=new AnimationStutterMonitor();frames(m,{duration:4400});
  assert.equal(frames(m,{start:7500,duration:4400,targetMs:50}),0);
});
