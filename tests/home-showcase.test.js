import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { Board } from '../src/board3d.js';
import { createHomeExample, homePadding, showcasePose, showcaseEnvelope, SHOWCASE_SETTLED_SECONDS } from '../src/home-showcase.js';

test('home illustration owns independent deterministic data and connected demonstration pieces',()=>{
  const a=createHomeExample(),b=createHomeExample();assert.deepEqual(a,b);
  const {buildings,roads}=a.homeDemo,vertex=buildings[0].vertex;assert.equal(a.board.vertices[vertex].level,2);assert.equal(roads.length,6);assert.equal(buildings.length,4);
  assert.equal(a.board.vertices.filter(v=>v.owner&&v.level===2).length,2);
  for(const {vertex:id}of buildings)assert.ok(a.board.vertices[id].edges.every(edge=>!buildings.some(other=>other.vertex!==id&&[a.board.edges[edge].a,a.board.edges[edge].b].includes(other.vertex))));
  let at=vertex;
  for(const road of roads){const edge=a.board.edges[road.edge];assert.equal(road.from,at);assert.ok([edge.a,edge.b].includes(road.from)&&[edge.a,edge.b].includes(road.to));at=road.to;}
  a.board.vertices[vertex].owner=null;a.board.edges[roads[0].edge].owner=null;
  assert.equal(b.board.vertices[vertex].owner,'illustration');assert.equal(b.board.edges[roads[0].edge].owner,'illustration');
  assert.deepEqual(a.legal,{});assert.equal(a.robber,null);
});

test('gentle loop builds four villages along six roads, upgrades two, rests and resets continuously',()=>{
  assert.equal(showcasePose(3).buildings[0].village,1);assert.deepEqual(showcasePose(3).roads,[0,0,0,0,0,0]);
  assert.equal(showcasePose(5).roads[0],1);assert.equal(showcasePose(5).roads[1],0);
  assert.equal(showcasePose(14).buildings.filter(p=>p.village===1).length,3);assert.deepEqual(showcasePose(14).roads,[1,1,1,1,1,1]);
  for(const t of [SHOWCASE_SETTLED_SECONDS,25,26])assert.deepEqual(showcasePose(t),{buildings:[{village:0,city:1},{village:1,city:0},{village:0,city:1},{village:1,city:0}],roads:[1,1,1,1,1,1]});
  assert.deepEqual(showcasePose(29.99),showcasePose(30));
  for(let t=0;t<30;t+=.1){const p=showcasePose(t);assert.ok([...p.buildings.flatMap(b=>[b.village,b.city]),...p.roads].every(n=>n>=0&&n<=1));}
});

test('home frame reserves measured title, subtitle, server, controls, dock and safe area',()=>{
  const rect=(left,top,right,bottom)=>({left,top,right,bottom});
  const elements={header:rect(0,0,390,66),welcome:rect(60,106,330,180),server:rect(14,72,160,90),controls:rect(80,700,310,750),dock:rect(20,774,370,830),safe:{top:20,bottom:34,left:4,right:5}};
  assert.deepEqual(homePadding(390,844,elements),{top:192,bottom:156,left:16,right:17});
  elements.welcome.bottom=216;assert.equal(homePadding(390,844,elements).top,228);
  const rail=homePadding(667,320,{...elements,brand:rect(10,6,150,54),nav:rect(480,6,655,54),welcome:rect(14,105,164,172),server:rect(14,64,169,96),controls:rect(14,256,160,306),dock:rect(495,162,653,306),sideControls:true});
  assert.deepEqual(rail,{top:32,bottom:46,left:181,right:199});
});

test('fixed home composition contains complete billboard ports and scenery throughout a full orbit',()=>{
  const state=createHomeExample(),points=showcaseEnvelope(state.board);
  for(const [width,height,padding] of [[1440,1000,{top:196,bottom:88,left:12,right:12}],[390,844,{top:181,bottom:146,left:12,right:12}],[320,568,{top:180,bottom:146,left:12,right:12}],[667,320,{top:12,bottom:12,left:176,right:226}],[844,390,{top:32,bottom:32,left:196,right:250}]]) {
    const view=Object.create(Board.prototype);
    Object.assign(view,{width,height,padding,homeShowcase:true,homeFitPoints:points,camera:new PerspectiveCamera(34,1,.1,150),controls:{target:new Vector3(),update(){view.camera.lookAt(this.target);view.camera.updateMatrixWorld();}},invalidate(){}});
    view.camera.position.set(Math.sin(.25)*Math.sin(.78)*16,Math.cos(.78)*16,Math.cos(.25)*Math.sin(.78)*16);view.updateProjection();view.fit();
    const distance=view.camera.position.length(),f=view.viewportFrame;
    for(let degrees=0;degrees<360;degrees+=5) {
      const angle=degrees*Math.PI/180;view.camera.position.set(Math.sin(angle)*Math.sin(.78)*distance,Math.cos(.78)*distance,Math.cos(angle)*Math.sin(.78)*distance);view.controls.update();
      const right=new Vector3().setFromMatrixColumn(view.camera.matrixWorld,0),up=new Vector3().setFromMatrixColumn(view.camera.matrixWorld,1);
      const actual=state.board.vertices.flatMap(v=>[0,1.05].map(y=>new Vector3(v.x,y,v.z)));
      for(const port of state.board.ports){const a=state.board.vertices[port.vertices[0]],b=state.board.vertices[port.vertices[1]],x=(a.x+b.x)/2,z=(a.z+b.z)/2,l=Math.hypot(x,z);for(const dx of [-.46,.46])for(const dy of [-.23,.23])actual.push(new Vector3(x+x/l*.69,.4,z+z/l*.69).addScaledVector(right,dx).addScaledVector(up,dy));}
      for(const p of actual){p.project(view.camera);assert.ok(Math.abs(p.x-f.centerX)<f.halfWidth&&Math.abs(p.y-f.centerY)<f.halfHeight,`${width}×${height} at ${degrees}° clips`);}
    }
  }
});
