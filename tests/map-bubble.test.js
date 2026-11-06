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
