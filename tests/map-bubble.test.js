import test from 'node:test';
import assert from 'node:assert/strict';
import {placeMapBubble} from '../src/map-bubble.js';

test('map labels stay in the viewport and retain the actual action anchor',()=>{
  for(const viewport of [{width:390,height:844},{width:667,height:320},{width:1366,height:768}]){
    for(const anchor of [{x:4,y:4},{x:viewport.width-4,y:viewport.height-4},{x:viewport.width/2,y:viewport.height/2}]){
      const original={...anchor},box=placeMapBubble(anchor,{width:180,height:46},viewport);
      assert.deepEqual(anchor,original);
      assert.ok(box.x>=8&&box.y>=8&&box.x+box.width<=viewport.width-8&&box.y+box.height<=viewport.height-8);
      assert.ok(box.edge.x>=box.x&&box.edge.x<=box.x+box.width&&box.edge.y>=box.y&&box.edge.y<=box.y+box.height);
    }
  }
});
test('map label moves beside the target when its normal position covers a token or HUD',()=>{
  const anchor={x:200,y:180},size={width:150,height:40},viewport={width:390,height:320};
  const obstacle={x:110,y:110,width:180,height:50},box=placeMapBubble(anchor,size,viewport,[obstacle]);
  assert.equal(box.blocked,0);
  assert.ok(box.y>=obstacle.y+obstacle.height||box.x>=obstacle.x+obstacle.width||box.x+box.width<=obstacle.x||box.y+box.height<=obstacle.y);
});

test('small camera movements preserve the clear label position instead of flipping sides',()=>{
  const size={width:230,height:68},viewport={width:390,height:844},obstacles=[{x:95,y:290,width:200,height:50}];
  let box=placeMapBubble({x:195,y:400},size,viewport,obstacles),first={x:box.x,y:box.y};
  for(let i=0;i<100;i++){
    box=placeMapBubble({x:195+Math.sin(i)*2,y:400+Math.cos(i)*2},size,viewport,obstacles,box);
    assert.deepEqual({x:box.x,y:box.y},first);assert.equal(box.blocked,0);
  }
});
test('held placement is discarded when blocked or outside a resized viewport',()=>{
  const size={width:160,height:50},viewport={width:390,height:844},anchor={x:180,y:400};
  const old=placeMapBubble(anchor,size,viewport);
  const next=placeMapBubble(anchor,size,viewport,[{x:old.x,y:old.y,width:old.width,height:old.height}],old);
  assert.equal(next.blocked,0);assert.notDeepEqual([next.x,next.y],[old.x,old.y]);
  const narrow=placeMapBubble(anchor,size,{width:200,height:450},[],{...old,x:300});
  assert.ok(narrow.x+narrow.width<=192);
});

test('obstacle-edge flicker requires sustained clear space before a bubble reappears',async()=>{
  const {BubbleVisibility}=await import('../src/map-bubble.js'),gate=new BubbleVisibility();
  assert.equal(gate.update(true,0),true);
  assert.equal(gate.update(false,10),false);
  for(let t=20;t<200;t+=20){assert.equal(gate.update(true,t),false);assert.equal(gate.update(false,t+10),false);}
  assert.equal(gate.update(true,210),false);assert.equal(gate.update(true,329),false);assert.equal(gate.update(true,330),true);
});
