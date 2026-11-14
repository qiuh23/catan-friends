import {withStartingRolls} from '../tests/fixtures/starting-rolls.js';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGame, addPlayer, act, botAction, viewFor } from '../shared/game.js';

// Renderer-only loopback fixtures; WebSocket privacy and real game interactions
// are covered by the existing multiplayer and public-event browser suites.
const url=process.env.TEST_URL||'http://127.0.0.1:5187',browser=await chromium.launch({headless:true}),results=[],errors=[];
await mkdir('test-results',{recursive:true});
function fixture(count) {
  let seed=41;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  let game=createGame(count>4?{playerExpansion:'five-six-2025'}:{});
  for(let i=0;i<count;i++)addPlayer(game,`p${i}`,`玩家${i+1}`,true);
  game=act(game,'p0',{type:'start'},withStartingRolls(count,random));
  while(game.phase.startsWith('setup-'))game=act(game,game.players[game.turn].id,botAction(game,game.players[game.turn].id),random);
  return viewFor(game,'p0');
}
async function verify(page,kind) {
  const report=await page.evaluate(async kind=>{
    const {Vector3}=await import('/node_modules/.vite/deps/three.js');
    const board=window.projectionBoard,map=window.projectionState.board,rect=board.container.getBoundingClientRect(),failures=[];
    for(const targetKind of ['edge','vertex','tile']) {
      const entries=map[targetKind==='edge'?'edges':targetKind==='vertex'?'vertices':'tiles'];
      for(const id of [0,Math.floor(entries.length/2),entries.length-1]) {
        let x,z,y;
        if(targetKind==='edge') {const edge=map.edges[id],a=map.vertices[edge.a],b=map.vertices[edge.b];x=(a.x+b.x)/2;z=(a.z+b.z)/2;y=.45;}
        else {({x,z}=entries[id]);y=targetKind==='vertex'?.65:.6;}
        let expected;
        if(kind==='3d') {const p=new Vector3(x,y,z).project(board.camera);expected={x:(p.x+1)*rect.width/2,y:(1-p.y)*rect.height/2};}
        else {
          const point=board.landscape?new DOMPoint(z*50+300,-x*50+290):new DOMPoint(x*50+300,z*50+290),p=point.matrixTransform(board.container.querySelector('svg').getScreenCTM());
          expected={x:p.x-rect.left,y:p.y-rect.top};
        }
        const actual=board.projectFeedbackTarget({kind:targetKind,id});
        if(!actual||Math.hypot(actual.x-expected.x,actual.y-expected.y)>.02)failures.push({targetKind,id,actual,expected});
      }
    }
    return {failures,callbacks:window.projectionChanges,view:board.exportView()};
  },kind);
  assert.deepEqual(report.failures,[],`${kind} notices drifted from map geometry`);return report;
}
try {
  for(const count of [3,6])for(const [name,viewport] of [['desktop',{width:1366,height:768}],['portrait',{width:390,height:844}],['landscape',{width:667,height:320}]]) {
    const context=await browser.newContext({viewport}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/map-projection-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#b8d8d2}#fixture{width:100%;height:100%}canvas,svg{display:block;width:100%;height:100%}</style><div id="fixture"></div>'}));
    await page.goto(`${url}/map-projection-fixture`);
    await page.evaluate(async state=>{
      window.projectionClasses=await import('/src/board.js');window.projectionState=state;window.projectionChanges=0;
      window.projectionBoard=new window.projectionClasses.Board(document.querySelector('#fixture'),()=>{},()=>{});
      window.projectionBoard.onProjectionChange=()=>window.projectionChanges++;
      window.projectionBoard.setViewportPadding({top:72,bottom:92,left:12,right:12});window.projectionBoard.set(state,'');
    },fixture(count));
    await page.locator('canvas[data-render-stats]').waitFor();await page.waitForTimeout(180);await verify(page,'3d');
    const changes=await page.evaluate(()=>window.projectionChanges);
    await page.evaluate(()=>{const board=window.projectionBoard;board.zoomBy(1.2);const offset=board.camera.position.clone().sub(board.controls.target);offset.applyAxisAngle({x:0,y:1,z:0},.3);board.camera.position.copy(board.controls.target).add(offset);board.controls.update();board.invalidate();});
    await page.waitForFunction(before=>window.projectionChanges>before,changes);await page.waitForTimeout(180);const manual=await verify(page,'3d');
    await page.evaluate(()=>{window.saved3d=window.projectionBoard.exportView();window.projectionBoard.dispose();window.projectionBoard=new window.projectionClasses.FlatBoard(document.querySelector('#fixture'),()=>{},()=>{});window.projectionBoard.onProjectionChange=()=>window.projectionChanges++;window.projectionBoard.setViewportPadding({top:72,bottom:92,left:12,right:12});window.projectionBoard.set(window.projectionState,'');window.projectionBoard.zoomBy(1.25);window.projectionBoard.pan.x=23;window.projectionBoard.pan.y=-17;window.projectionBoard.resize();});
    const flat=await verify(page,'2d');assert.ok(flat.callbacks>manual.callbacks,'SVG projection did not notify');
    await page.evaluate(()=>{window.saved2d=window.projectionBoard.exportView();window.projectionBoard.dispose();window.projectionBoard=new window.projectionClasses.Board(document.querySelector('#fixture'),()=>{},()=>{});window.projectionBoard.onProjectionChange=()=>window.projectionChanges++;window.projectionBoard.setViewportPadding({top:72,bottom:92,left:12,right:12});window.projectionBoard.set(window.projectionState,'');if(!window.projectionBoard.importView(window.saved3d))throw Error('3D camera restore rejected');});
    await page.locator('canvas[data-camera]').waitFor();await page.waitForTimeout(180);const restored=await verify(page,'3d');
    const near=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<1e-7);assert.ok(near(restored.view.position,manual.view.position),'3D toggle changed eye');assert.ok(near(restored.view.target,manual.view.target),'3D toggle changed target');assert.deepEqual(restored.view.view,manual.view.view,'3D toggle changed projection');
    await page.evaluate(()=>{window.projectionBoard.dispose();window.projectionBoard=new window.projectionClasses.FlatBoard(document.querySelector('#fixture'),()=>{},()=>{});window.projectionBoard.onProjectionChange=()=>window.projectionChanges++;window.projectionBoard.setViewportPadding({top:72,bottom:92,left:12,right:12});window.projectionBoard.set(window.projectionState,'');if(!window.projectionBoard.importView(window.saved2d))throw Error('2D camera restore rejected');});
    const restoredFlat=await verify(page,'2d');assert.equal(restoredFlat.view.zoom,flat.view.zoom);assert.deepEqual(restoredFlat.view.pan,flat.view.pan);
    await page.setViewportSize({width:viewport.height,height:viewport.width});await page.waitForTimeout(120);await verify(page,'2d');
    await page.evaluate(()=>window.projectionBoard.dispose());results.push({count,name,targetsPerView:9,renderers:2,restoredViews:true,rotated:true});await context.close();
  }
  assert.deepEqual(errors,[]);await writeFile('test-results/map-projection-browser.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({passed:results.length,results},null,2));
}finally {await browser.close();}
