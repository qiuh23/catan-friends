import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { createBoard } from '../shared/board.js';
import { Board } from '../src/board3d.js';
import { boardFrame } from '../src/board-frame.js';

function cameraFixture(width,height,padding,expanded=false) {
  const b=createBoard(()=>.43,{playerExpansion:expanded?'five-six-2025':'base'}),view=Object.create(Board.prototype);
  Object.assign(view,{width,height,padding,boardScale:1,camera:new PerspectiveCamera(34,width/height,.1,150),
    controls:{target:new Vector3(),update(){view.camera.lookAt(this.target);view.camera.updateMatrixWorld();}},invalidate(){}});
  view.fitPoints=[...b.vertices.map(v=>({...v,y:.4})),...b.tiles.map(t=>({...t,y:1}))];
  view.portBounds=b.ports.map(p=>{
    const a=b.vertices[p.vertices[0]],c=b.vertices[p.vertices[1]],x=(a.x+c.x)/2,z=(a.z+c.z)/2,l=Math.hypot(x,z);
    return {x:x+x/l*.69,y:.4,z:z+z/l*.69};
  });
  view.camera.position.set(6.5,11,12);view.updateProjection();view.fit(false);return view;
}

test('base and expanded island geometry plus every port fit inside stable HUD bounds',()=>{
  for(const expanded of [false,true])for(const [width,height,top,bottom] of [
    [1440,960,80,132],[390,844,112,128],[844,390,64,84],[320,568,112,128],[667,320,64,84],
  ]) {
    const view=cameraFixture(width,height,{top,bottom,left:12,right:12},expanded),f=view.viewportFrame;
    const points=view.fitPoints.map(p=>new Vector3(p.x,p.y,p.z));
    const right=new Vector3().setFromMatrixColumn(view.camera.matrixWorld,0),up=new Vector3().setFromMatrixColumn(view.camera.matrixWorld,1);
    for(const p of view.portBounds)for(const dx of [-.46,.46])for(const dy of [-.23,.23])points.push(new Vector3(p.x,p.y,p.z).addScaledVector(right,dx).addScaledVector(up,dy));
    for(const p of points) {
      p.project(view.camera);
      assert.ok(Math.abs(p.x-f.centerX)<=f.halfWidth*1.007,`port or geometry clips horizontally at ${width}×${height}`);
      assert.ok(Math.abs(p.y-f.centerY)<=f.halfHeight*1.007,`port or geometry clips vertically at ${width}×${height}`);
    }
  }
});

test('actual viewport changes preserve manually chosen camera direction and relative zoom',()=>{
  const view=cameraFixture(390,844,{top:112,bottom:128,left:12,right:12},true);
  view.camera.position.applyAxisAngle(new Vector3(0,1,0),.5).multiplyScalar(.72);
  const direction=view.camera.position.clone().normalize(),zoom=view.camera.position.length()/view.fitDistance;
  view.width=844;view.height=390;view.padding={top:64,bottom:84,left:12,right:12};view.updateProjection();view.fit(true);
  assert.ok(view.camera.position.clone().normalize().distanceTo(direction)<1e-9);
  assert.ok(Math.abs(view.camera.position.length()/view.fitDistance-zoom)<1e-9);
});

test('a new island uses the current canvas orientation instead of the home preview pitch',()=>{
  for(const [width,height,direction] of [[390,844,[.3,16,3]],[844,390,[14,8,.3]]]){
    const view=cameraFixture(width,height,{top:112,bottom:128,left:12,right:12},true);
    view.camera.position.set(14,8,.3);view.controls.target.set(1,.2,1);
    view.reset({defaultOrientation:true});
    assert.ok(view.camera.position.clone().normalize().distanceTo(new Vector3(...direction).normalize())<1e-9);
    assert.deepEqual(view.controls.target.toArray(),[0,0,0]);assert.equal(view.viewMode,'overview');
    const bearing=view.camera.position.clone().normalize();view.reset();
    assert.ok(view.camera.position.clone().normalize().distanceTo(bearing)<1e-9,'ordinary reset changed the chosen bearing');
  }
});

test('an extremely small visual viewport retains a finite play frame',()=>{
  const frame=boardFrame(320,180,{left:-2,right:NaN,top:112,bottom:128});
  assert.ok(frame.width>0&&frame.height>0);
  assert.equal(frame.left,0);assert.equal(frame.right,0);
});
