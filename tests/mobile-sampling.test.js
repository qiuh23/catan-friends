import test from 'node:test';
import assert from 'node:assert/strict';
import {boardPixelRatio} from '../src/graphics-quality.js';
import {Board} from '../src/board3d.js';

test('high quality improves mobile detail without exceeding native DPR or two million pixels',()=>{
  for(const [w,h] of [[390,700],[844,390],[430,932],[1024,1366],[1920,1080],[3840,2160]]){
    for(const native of [1,1.5,2,3]){
      const ratio=boardPixelRatio(w,h,native,{mobile:true});
      assert.ok(ratio<=native&&ratio<=2);
      assert.ok(Math.floor(w*ratio)*Math.floor(h*ratio)<=2000000);
      assert.equal(ratio,boardPixelRatio(w,h,native,{mobile:false}));
    }
  }
  assert.equal(boardPixelRatio(390,700,3,{mobile:true}),2);
  assert.equal(boardPixelRatio(390,700,3,{mobile:true,lowPower:true}),1.35);
  assert.equal(boardPixelRatio(390,700,1,{mobile:true}),1);
  assert.equal(boardPixelRatio(0,0),1);
  assert.equal(boardPixelRatio(390,700,NaN),1);
});

test('duplicate resize avoids drawing buffer resets and shadow invalidation, DPR and quality changes still apply',()=>{
  const originals=new Map(['matchMedia','innerWidth','innerHeight','devicePixelRatio'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  Object.assign(globalThis,{matchMedia:()=>({matches:true}),innerWidth:390,innerHeight:844,devicePixelRatio:3});
  let buffers=0,lighting=0,lanterns=0,projection=0,ratio=1;
  const board={container:{clientWidth:390,clientHeight:700},quality:'high',lowPower:false,
    renderer:{domElement:{dataset:{}},getPixelRatio:()=>ratio,setDrawingBufferSize(w,h,dpr){buffers++;ratio=dpr;}},
    environment:{setQuality(){lighting++;},getState:()=>({night:0})},nightLights:{setNight(){lanterns++;}},
    stutter:{suspend(){}},cancelFocus(){},updateProjection(){projection++;},invalidate(){}};
  try{
    const resize=()=>Board.prototype.resize.call(board);
    resize();assert.deepEqual([buffers,lighting,lanterns,projection],[1,1,1,1]);
    for(let i=0;i<100;i++)resize();
    assert.deepEqual([buffers,lighting,lanterns,projection],[1,1,1,1]);
    globalThis.devicePixelRatio=1.5;resize();assert.equal(buffers,2);assert.equal(projection,1);assert.equal(lighting,1);
    board.container.clientWidth=844;board.container.clientHeight=390;resize();assert.equal(buffers,3);assert.equal(projection,2);assert.equal(lighting,1);
    board.lowPower=true;board.quality='low';resize();assert.equal(ratio,1.35);assert.equal(lighting,2);assert.equal(lanterns,2);
    resize();assert.equal(lighting,2);board.lowPower=false;resize();assert.equal(ratio,1.5);assert.equal(lighting,3);
  }finally{for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
