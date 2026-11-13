import test from 'node:test';
import assert from 'node:assert/strict';
import {installOutsideCostDismissal} from '../src/cost-dismissal.js';
function harness() {
  const handlers=new Map();let count=0;
  installOutsideCostDismissal({addEventListener(type,handler){handlers.set(type,handler);}},()=>count++);
  return {get count(){return count;},event(type,{id=1,x=10,y=20,interactive=false,button=0}={}) {
    handlers.get(type)({pointerId:id,clientX:x,clientY:y,button,target:{closest(){return interactive?{}:null;}}});
  }};
}
test('only a stationary primary pointer tap on outside blank space dismisses costs',()=>{
  const h=harness();h.event('pointerdown');h.event('pointerup');assert.equal(h.count,1);
  h.event('pointerdown',{interactive:true});h.event('pointerup');assert.equal(h.count,1);
  h.event('pointerdown');h.event('pointerup',{interactive:true});assert.equal(h.count,1);
  h.event('pointerdown',{button:2});h.event('pointerup',{button:2});assert.equal(h.count,1);
});
test('drag, drag back to origin, pinch, and canceled pointers never dismiss costs',()=>{
  const h=harness();
  h.event('pointerdown');h.event('pointermove',{x:30});h.event('pointerup',{x:30});
  h.event('pointerdown');h.event('pointermove',{x:30});h.event('pointermove');h.event('pointerup');
  h.event('pointerdown');h.event('pointerdown',{id:2});h.event('pointerup',{id:2});h.event('pointerup');
  h.event('pointerdown');h.event('pointercancel');h.event('pointerup');
  assert.equal(h.count,0);h.event('pointerdown');h.event('pointerup');assert.equal(h.count,1);
});
