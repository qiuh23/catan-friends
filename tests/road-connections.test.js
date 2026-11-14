import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {roadConnections,roadLampPose,roadSiteHeight,ROAD_JOIN_REACH} from '../src/visuals/road-geometry.js';
import {addRoad,addRoadJunction} from '../src/pieces.js';
import {BoardAssets,Batches} from '../src/terrain.js';
const fixture=()=>({vertices:[{id:0,x:0,z:0,owner:null},...Array.from({length:3},(_,i)=>({id:i+1,x:Math.cos(i*2*Math.PI/3),z:Math.sin(i*2*Math.PI/3),owner:null}))],edges:Array.from({length:3},(_,i)=>({id:i,a:0,b:i+1,owner:i<2?'red':null}))});
test('same owner bends and branches join; isolated/different owners and opponent buildings do not',()=>{
 const b=fixture(),unchanged=JSON.stringify(b);let c=roadConnections(b);assert.equal(c.joined.get(0),'red');assert.equal(c.joined.size,1);assert.deepEqual(c.ends(b.edges[0]),[ROAD_JOIN_REACH,null]);assert.equal(JSON.stringify(b),unchanged);
 b.edges[2].owner='red';assert.equal(roadConnections(b).joined.size,1);
 b.vertices[0].owner='blue';assert.equal(roadConnections(b).joined.size,0);
 b.vertices[0].owner='red';assert.equal(roadConnections(b).joined.size,1);
 b.vertices[0].owner=null;b.edges[1].owner='blue';b.edges[2].owner=null;assert.equal(roadConnections(b).joined.size,0);
 b.edges[2].owner='red';c=roadConnections(b);assert.equal(c.joined.get(0),'red');assert.deepEqual(c.ends(b.edges[1]),[.16,null]);
});
test('connected paving reaches the junction in either endpoint order while open ends and lamps stay fixed',()=>{
 const b=fixture(),c=roadConnections(b),assets=new BoardAssets();
 for(const edge of b.edges.filter(e=>e.owner)){
  const a=b.vertices[edge.a],z=b.vertices[edge.b],forward=new Batches(assets),reverse=new Batches(assets),ends=c.ends(edge),lamp=roadLampPose(a,z);
  addRoad(forward,a,z,'#cc6655',{ends});addRoad(reverse,z,a,'#cc6655',{ends:[ends[1],ends[0]]});assert.deepEqual(forward.entries,reverse.entries);assert.deepEqual(roadLampPose(z,a),lamp);
  const p=forward.entries.get('pieces:paving').items[0],r=Math.hypot(p.x-a.x,p.z-a.z);assert.ok(Math.abs(r-p.sx/2-(ROAD_JOIN_REACH-.0175))<1e-6,'paving must meet the junction portal');
 }
 const batch=new Batches(assets),layer=new THREE.Group();for(const edge of b.edges.filter(e=>e.owner))addRoad(batch,b.vertices[edge.a],b.vertices[edge.b],'#cc6655',{ends:c.ends(edge)});addRoadJunction(batch,b.vertices[0],'#cc6655',c.junctions.get(0));batch.finish(layer);
 assert.ok(layer.children.length<=8,'junction must reuse instanced primitives');assert.ok(layer.children.every(m=>!m.userData.kind&&!m.userData.id),'no interactive targets added');assets.dispose();
});


test('junctions keep legal settlement hints above their surface without changing hit regions or occlusion rules',async()=>{
 const {Board}=await import('../src/board3d.js'),b=fixture(),c=roadConnections(b),assets=new BoardAssets(),batch=new Batches(assets),pieces=new THREE.Group();
 for(const edge of b.edges.filter(e=>e.owner))addRoad(batch,b.vertices[edge.a],b.vertices[edge.b],'#cc6655',{ends:c.ends(edge)});addRoadJunction(batch,b.vertices[0],'#cc6655',c.junctions.get(0));batch.finish(pieces);pieces.updateMatrixWorld(true);
 const marker=new THREE.Object3D();marker.position.set(0,roadSiteHeight('settlement',0,c.joined),0);
 assert.equal(roadSiteHeight('road',0,c.joined),.298);assert.equal(roadSiteHeight('settlement',1,c.joined),.298);
 for(const position of [[.3,16,3],[14,8,.3],[-14,8,.3]]){
  const camera=new THREE.PerspectiveCamera();camera.position.set(...position);camera.lookAt(marker.position);camera.updateMatrixWorld();
  const view=Object.assign(Object.create(Board.prototype),{camera,land:new THREE.Group(),pieces,raycaster:new THREE.Raycaster(),mode:'settlement'});
  assert.equal(view.siteVisible(marker),true,'paving must not occlude the settlement hint');
 }
 assets.dispose();
});


test('two-arm turns and three-arm branches have a continuous road-width surface with no round pads or capped arms',()=>{
 const assets=new BoardAssets(),down=new THREE.Vector3(0,-1,0),ray=new THREE.Raycaster();
 for(const arms of [2,3])for(let rotation=0;rotation<6;rotation++){
  const b=fixture();if(arms===3)b.edges[2].owner='red';
  const angle=rotation*Math.PI/3;for(const v of b.vertices){const x=v.x,z=v.z;v.x=x*Math.cos(angle)-z*Math.sin(angle);v.z=x*Math.sin(angle)+z*Math.cos(angle);}
  const c=roadConnections(b),batch=new Batches(assets),layer=new THREE.Group();
  for(const edge of b.edges.filter(e=>e.owner))addRoad(batch,b.vertices[edge.a],b.vertices[edge.b],'#cc6655',{ends:c.ends(edge)});addRoadJunction(batch,b.vertices[0],'#cc6655',c.junctions.get(0));batch.finish(layer);layer.updateMatrixWorld(true);
  assert.ok(![...batch.entries.keys()].some(key=>key.includes('cylinder')));
  for(const edge of b.edges.filter(e=>e.owner)){
   const v=b.vertices[edge.b],dx=v.x,dz=v.z;
   // Across the connector portal: centre paving and both owner-colour curbs.
   for(const distance of [.10,.18,.219,.220,.221,.24,.28])for(const side of [0,-.078,.078]){
    ray.set(new THREE.Vector3(dx*distance-dz*side,2,dz*distance+dx*side),down);const hit=ray.intersectObjects(layer.children,false)[0];
    assert.ok(hit,`${arms} arms, ${rotation}, ${distance}, ${side}: no gap`);assert.ok(hit.point.y>=.315,`surface ${arms} ${rotation} ${distance} ${side}: ${hit.point.y}`);
    if(side)assert.ok(hit.point.y>=.347,'owner curb must stay continuous through the join');
   }
  }
  for(const mesh of layer.children)mesh.dispose();
 }
 assets.dispose();
});
