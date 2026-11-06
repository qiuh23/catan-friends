import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3, Group, Mesh, BoxGeometry, MeshBasicMaterial, Object3D, Raycaster } from 'three';
import { createBoard } from '../shared/board.js';
import { Board } from '../src/board3d.js';
import { feedbackAnchor, mapViewKey } from '../src/map-feedback.js';

const board=createBoard(()=>.43);
test('notice anchors use an edge midpoint, intersection or tile centre, and reject missing map targets',()=>{
  for(const map of [board,createBoard(()=>.43,{playerExpansion:'five-six-2025'})]) {
    for(const edge of map.edges) {
      const point=feedbackAnchor(map,{kind:'edge',id:edge.id}),a=map.vertices[edge.a],b=map.vertices[edge.b];
      assert.equal(point.x,(a.x+b.x)/2);assert.equal(point.z,(a.z+b.z)/2);
    }
    for(const kind of ['vertex','tile'])for(const point of map[kind==='vertex'?'vertices':'tiles']) {
      const anchor=feedbackAnchor(map,{kind,id:point.id});assert.equal(anchor.x,point.x);assert.equal(anchor.z,point.z);
    }
  }
  for(const target of [null,{kind:'hand',id:0},{kind:'vertex',id:-1},{kind:'tile',id:'0'},{kind:'edge',id:999},{kind:'tile',id:NaN}])assert.equal(feedbackAnchor(board,target),null);
});

test('3D notices project into the actual canvas rectangle and mark clipped targets invisible',()=>{
  const camera=new PerspectiveCamera(34,1000/600,.1,150);camera.position.set(10,12,9);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const view=Object.create(Board.prototype);
  Object.assign(view,{board,camera,renderer:{domElement:{getBoundingClientRect:()=>({left:30,top:50,width:1000,height:600})}},container:{getBoundingClientRect:()=>({left:10,top:20,width:1100,height:700})}});
  const anchor=feedbackAnchor(board,{kind:'edge',id:0}),p=new Vector3(anchor.x,anchor.y,anchor.z).project(camera),projected=view.projectFeedbackTarget({kind:'edge',id:0});
  assert.ok(Math.abs(projected.x-(20+(p.x+1)*500))<1e-8);assert.ok(Math.abs(projected.y-(30+(1-p.y)*300))<1e-8);assert.equal(projected.visible,true);
  camera.lookAt(100,100,100);camera.updateMatrixWorld();assert.equal(view.projectFeedbackTarget({kind:'edge',id:0}).visible,false);
  assert.equal(view.projectFeedbackTarget({kind:'hand',id:0}),null);
});

test('renderer camera identity survives ownership changes and rejects a rematch island',()=>{
  const same=structuredClone(board);same.vertices[0].owner='p0';same.vertices[0].level=2;same.edges[0].owner='p0';
  assert.equal(mapViewKey(same),mapViewKey(board));
  const next=structuredClone(board);next.tiles[0].number=99;assert.notEqual(mapViewKey(next),mapViewKey(board));
});

test('ground marker hit regions respect real scenery while city upgrades allow their own footprint',()=>{
  const view=Object.create(Board.prototype),land=new Group(),pieces=new Group(),camera=new PerspectiveCamera(),marker=new Object3D();
  camera.position.set(0,2,5);marker.position.set(0,.298,0);
  const material=new MeshBasicMaterial(),geometry=new BoxGeometry(.3,.4,.3),own=new Mesh(geometry,material);own.position.set(0,.5,0);pieces.add(own);
  Object.assign(view,{land,pieces,camera,raycaster:new Raycaster(),mode:'settlement'});pieces.updateMatrixWorld(true);
  assert.equal(view.siteVisible(marker),false);
  view.mode='city';assert.equal(view.siteVisible(marker),true);
  const tree=new Mesh(geometry,material);tree.position.set(0,1.15,2.5);land.add(tree);land.updateMatrixWorld(true);
  assert.equal(view.siteVisible(marker),false,'an upgrade cannot click through an unrelated foreground object');
  tree.visible=false;assert.equal(view.siteVisible(marker),true);
  geometry.dispose();material.dispose();
});

test('number obstacles grow with near zoom and enclose the actual sprite centre',()=>{
  const view=Object.create(Board.prototype),camera=new PerspectiveCamera(34,1000/600,.1,150);
  Object.assign(view,{board,camera,renderer:{domElement:{getBoundingClientRect:()=>({left:0,top:0,width:1000,height:600})}},
    container:{getBoundingClientRect:()=>({left:0,top:0,width:1000,height:600})}});
  camera.position.set(14,16,14);camera.lookAt(0,0,0);camera.updateMatrixWorld();const far=view.projectNumberObstacles();
  camera.position.multiplyScalar(.55);camera.lookAt(0,0,0);camera.updateMatrixWorld();const near=view.projectNumberObstacles();
  assert.equal(near.length,board.tiles.filter(t=>t.number).length);
  for(const [index,tile] of board.tiles.filter(t=>t.number).entries()) {
    assert.ok(near[index].width>far[index].width*1.4,'near numbers cannot use a constant screen-space exclusion');
    const p=new Vector3(tile.x,.43,tile.z).project(camera),x=(p.x+1)*500,y=(1-p.y)*300,box=near[index];
    assert.ok(x>box.x&&x<box.x+box.width&&y>box.y&&y<box.y+box.height);
  }
});
