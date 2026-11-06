import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { createBoard } from '../shared/board.js';
import { feedbackPoints, planActionCamera } from '../src/action-camera.js';
import { boardFrame } from '../src/board-frame.js';
import { Board } from '../src/board3d.js';
import { FlatBoard } from '../src/board.js';

const board=createBoard(()=>.43);
const near=(a,b)=>Math.abs(a-b)<1e-8;

test('public target coordinates reject unknown or malformed targets',()=>{
  assert.equal(feedbackPoints(board,{targets:[{kind:'edge',id:0}]}).length,2);
  assert.equal(feedbackPoints(board,{targets:[{kind:'tile',id:0}]}).length,7);
  assert.deepEqual(feedbackPoints(board,{targets:[{kind:'hand',id:0},{kind:'vertex',id:-1},{kind:'tile',id:'0'},{kind:'edge',id:999}]}),[]);
});

test('focus frames corner roads, buildings and robber tiles inside real portrait, landscape and short-screen HUD areas',()=>{
  for(const [width,height,padding] of [
    [1440,960,{left:76,right:20,top:100,bottom:180}],
    [390,844,{left:14,right:64,top:130,bottom:160}],
    [844,390,{left:80,right:70,top:66,bottom:115}],
    [667,320,{left:78,right:70,top:70,bottom:105}],
  ])for(const kind of ['edge','vertex','tile'])for(const id of [0,board[kind==='edge'?'edges':kind==='vertex'?'vertices':'tiles'].length-1]) {
    const frame=boardFrame(width,height,padding),event={targets:[{kind,id}]};
    const plan=planActionCamera(board,event,{position:{x:12,y:11,z:13},target:{x:0,y:0,z:0},frame});
    assert.ok(plan.distance>=6&&plan.distance<=45);
    const camera=new PerspectiveCamera(34,width/height,.1,150);
    camera.setViewOffset(frame.width,frame.height,-frame.left,-frame.top,width,height);
    camera.position.set(plan.position.x,plan.position.y,plan.position.z);camera.lookAt(plan.target.x,plan.target.y,plan.target.z);camera.updateMatrixWorld();
    for(const p of feedbackPoints(board,event)) {
      const projected=new Vector3(p.x,p.y,p.z).project(camera);
      assert.ok(Math.abs(projected.x-frame.centerX)<frame.halfWidth,`${kind} x at ${width}×${height}`);
      assert.ok(Math.abs(projected.y-frame.centerY)<frame.halfHeight,`${kind} y at ${width}×${height}`);
    }
  }
});

test('automatic framing keeps the existing bearing and limits pitch and zoom',()=>{
  const target={x:2,y:.5,z:-1},position={x:14,y:12,z:9},frame=boardFrame(390,844,{top:120,bottom:150});
  const plan=planActionCamera(board,{targets:[{kind:'vertex',id:0}]},{position,target,frame});
  assert.ok(near(plan.yaw,Math.atan2(position.x-target.x,position.z-target.z)));
  assert.ok(plan.distance>=Math.hypot(position.x-target.x,position.y-target.y,position.z-target.z)*.86-1e-8);
  const low=planActionCamera(board,{targets:[{kind:'vertex',id:0}]},{position:{x:8,y:.01,z:8},frame});
  assert.ok(low.polar<=1.05&&low.position.y>3);
  assert.equal(planActionCamera(board,{targets:[]},{position,frame}),null);
});

test('manual cancellation immediately removes camera animation without resetting its current view',()=>{
  const view=Object.create(Board.prototype),position=new Vector3(8,10,12),target=new Vector3(2,.5,-1);
  Object.assign(view,{camera:{position},controls:{target},focusAnimation:{},invalidate(){},onManual(){view.notified=true;}});
  view.manualInput();
  assert.equal(view.focusAnimation,null);assert.equal(view.viewMode,'manual');assert.equal(view.notified,true);
  assert.deepEqual(position.toArray(),[8,10,12]);assert.deepEqual(target.toArray(),[2,.5,-1]);
});

test('cancelling an idle camera does not schedule a render for chat or focus changes',()=>{
  const view=Object.create(Board.prototype);let renders=0;
  Object.assign(view,{focusAnimation:null,invalidate(){renders++;}});
  view.cancelFocus();view.cancelFocus();assert.equal(renders,0);
  view.focusAnimation={};view.cancelFocus();assert.equal(view.focusAnimation,null);assert.equal(renders,1);
  view.cancelFocus();assert.equal(renders,1);
});

test('reduced motion and an active pointer never start an automatic shot',()=>{
  const view=Object.create(Board.prototype);view.pointers=new Set();
  assert.equal(view.focusFeedback({targets:[{kind:'vertex',id:0}]},{reducedMotion:true}),false);
  view.pointers.add(1);assert.equal(view.focusFeedback({targets:[{kind:'vertex',id:0}]}),false);
});

test('changing the HUD preserves a manual target, bearing and distance while cancelling the old shot',()=>{
  const view=Object.create(Board.prototype);
  Object.assign(view,{width:844,height:390,board,viewMode:'manual',camera:new PerspectiveCamera(34,844/390,.1,150),
    controls:{target:new Vector3(2,.5,-1)},focusAnimation:{},invalidate(){}});
  view.camera.position.set(10,12,9);
  view.setViewportPadding({left:80,right:70,top:70,bottom:105});
  assert.deepEqual(view.camera.position.toArray(),[10,12,9]);assert.deepEqual(view.controls.target.toArray(),[2,.5,-1]);
  assert.equal(view.focusAnimation,null);assert.equal(view.viewportFrame.height,215);
});

test('expanded island targets use the same bounded framing geometry',()=>{
  const expanded=createBoard(()=>.43,{playerExpansion:'five-six-2025'}),scale=1.4,frame=boardFrame(390,844,{top:120,bottom:160});
  const event={targets:[{kind:'tile',id:expanded.tiles.length-1}]},plan=planActionCamera(expanded,event,{position:{x:16,y:15,z:15},frame,scale});
  assert.ok(plan.distance>=6*scale&&plan.distance<=45*scale);
  assert.ok(plan.position.y>=.5+Math.cos(1.05)*6*scale);
});

test('notice padding never moves an overview eye with reduced motion or preserveView',()=>{
  for(const options of [{reducedMotion:true},{preserveView:true}]) {
    const view=Object.create(Board.prototype);
    Object.assign(view,{width:390,height:844,board,viewMode:'overview',reducedMotion:options.reducedMotion,
      camera:new PerspectiveCamera(34,390/844,.1,150),controls:{target:new Vector3()},invalidate(){},fit(){assert.fail('notice refitted the eye');}});
    view.camera.position.set(10,12,9);
    view.setViewportPadding({left:14,right:64,top:180,bottom:160},{preserveView:options.preserveView});
    assert.deepEqual(view.camera.position.toArray(),[10,12,9]);assert.deepEqual(view.controls.target.toArray(),[0,0,0]);
    assert.equal(view.viewportFrame.height,504);
  }
});

test('a burst of automatic 3D shots shares one distance floor instead of repeatedly zooming in',()=>{
  const view=Object.create(Board.prototype),camera=new PerspectiveCamera(34,1,.1,150),target=new Vector3();camera.position.set(12,12,12);
  const original=camera.position.length();
  Object.assign(view,{board,camera,pointers:new Set(),boardScale:1,viewportFrame:boardFrame(1000,700),
    controls:{target,minDistance:6,maxDistance:45,update(){}},updateProjection(){},invalidate(){}});
  let first;
  for(let i=0;i<16;i++) {
    assert.equal(view.focusFeedback({id:i,targets:[{kind:'vertex',id:0}]},{reducedMotion:true,manual:true}),true);
    const distance=camera.position.distanceTo(target);first??=distance;
    assert.ok(distance>=original*.86-1e-8);assert.ok(near(distance,first));
  }
  view.manualInput();assert.equal(view.followBaseline,null);
});

test('a burst of 2D action framing uses a single 16 percent zoom allowance',()=>{
  const view=Object.create(FlatBoard.prototype);
  Object.assign(view,{state:{board},container:{clientWidth:1000,clientHeight:700},contentBounds:{x:0,y:0,width:600,height:600},
    pointers:new Set(),pan:{x:0,y:0},zoom:1,cancelFocus(){},resize(){}});
  for(let i=0;i<16;i++) {
    assert.equal(view.focusFeedback({targets:[{kind:'vertex',id:0}]},{reducedMotion:true,manual:true}),true);
    assert.ok(near(view.zoom,1.16));
  }
  view.manualInput();assert.equal(view.followZoomBaseline,null);
});
