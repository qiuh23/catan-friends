import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGame, addPlayer, act, botAction, viewFor } from '../shared/game.js';

// Renderer-only loopback fixtures: all positions come from a legal setup. One
// village per owner is promoted to show both silhouettes in every player colour.
// Requires the local Vite development server for renderer module imports.
const url=process.env.TEST_URL||'http://127.0.0.1:5184';
const browser=await chromium.launch({headless:true}),results=[],errors=[];
await mkdir('test-results',{recursive:true});
function fixture(count){
  let seed=31,random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  let game=createGame(count>4?{playerExpansion:'five-six-2025'}:{});
  for(let i=0;i<count;i++)addPlayer(game,`p${i}`,`玩家${i+1}`,true);
  game=act(game,'p0',{type:'start'},random);
  while(game.phase.startsWith('setup-'))game=act(game,game.players[game.turn].id,botAction(game,game.players[game.turn].id),random);
  game.phase='action';game.turn=0;
  for(const p of game.players)game.board.vertices.find(v=>v.owner===p.id).level=2;
  return viewFor(game,'p0');
}
try{
  for(const [count,name,viewport,touch] of [[3,'base-desktop',{width:1440,height:960},false],[6,'expanded-portrait',{width:390,height:844},true],[6,'expanded-landscape',{width:844,height:390},true]]){
    const context=await browser.newContext({viewport,isMobile:touch,hasTouch:touch,deviceScaleFactor:touch?3:1});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/building-visual-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#b8d8d2}#fixture{width:100%;height:100%}canvas,svg{display:block;width:100%;height:100%}</style><div id="fixture"></div>'}));
    await page.goto(`${url}/building-visual-fixture`);
    const state=fixture(count);
    await page.evaluate(async state=>{const {Board,FlatBoard}=await import('/src/board.js');window.boardClasses={Board,FlatBoard};window.testState=state;window.selections=[];window.fixtureBoard=new Board(document.querySelector('#fixture'),target=>window.selections.push(target),()=>{});window.fixtureBoard.set(state,'road');},{...state});
    await page.locator('canvas[data-render-stats]').waitFor();await page.waitForTimeout(180);
    const stats=JSON.parse(await page.locator('canvas').getAttribute('data-render-stats'));
    assert.ok(stats.calls<=100&&stats.triangles<=(touch?25000:45000));
    assert.ok(stats.geometries<=12,'shared geometry pool grows beyond two site silhouettes');
    assert.equal(await page.locator('canvas').getAttribute('data-site-shape'),'road');
    const position=await page.evaluate(()=>{const marker=window.fixtureBoard.markerTargets[0],p=marker.position.clone().project(window.fixtureBoard.camera),rect=document.querySelector('canvas').getBoundingClientRect();return {id:marker.userData.id,x:rect.x+(p.x+1)*rect.width/2,y:rect.y+(1-p.y)*rect.height/2};});
    if(!touch){await page.mouse.move(position.x,position.y);assert.equal(await page.locator('canvas').getAttribute('data-selected-site'),`edge:${position.id}`);}
    await page.screenshot({path:`test-results/buildings-${name}-3d.png`,scale:'css'});
    await page.evaluate(()=>{const board=window.fixtureBoard;board.set(window.testState,'city');board.setFeedback({targets:[{kind:'vertex',id:window.testState.board.vertices.find(v=>v.level===2).id},{kind:'edge',id:window.testState.board.edges.find(e=>e.owner).id}]});});
    await page.waitForTimeout(100);await page.screenshot({path:`test-results/buildings-${name}-3d-city-feedback.png`,scale:'css'});
    await page.evaluate(()=>{window.fixtureBoard.dispose();window.fixtureBoard=new window.boardClasses.FlatBoard(document.querySelector('#fixture'),target=>window.selections.push(target),()=>{});window.fixtureBoard.set(window.testState,'city');});
    assert.equal(await page.locator('[data-building="settlement"]').count(),count);
    assert.equal(await page.locator('[data-building="city"]').count(),count);
    const site=page.locator('[data-site-shape="city"]').first();await site.focus();
    assert.equal(await site.getAttribute('data-selected'),'true');assert.equal(await site.locator('[data-marker-fill]').getAttribute('fill'),'#155c9c');
    await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.selections.at(-1)?.kind),'vertex');
    await page.evaluate(()=>window.fixtureBoard.setFeedback({targets:[{kind:'vertex',id:window.testState.board.vertices.find(v=>v.level===2).id}]}));
    await page.screenshot({path:`test-results/buildings-${name}-2d-city-feedback.png`,scale:'css'});
    await page.evaluate(()=>window.fixtureBoard.set(window.testState,'road'));
    assert.ok(await page.locator('[data-site-shape="road"] rect').count()>0,'road sites must be aligned bars');
    await page.evaluate(()=>window.fixtureBoard.set(window.testState,'settlement'));
    // Settlement outlines can be verified with legal setup positions, when the
    // current player's roads do not yet reach an empty distance-rule site.
    await page.evaluate(()=>{if(!window.testState.legal.settlement.length)window.testState.legal.settlement=[window.testState.board.vertices.find(v=>!v.owner).id];window.fixtureBoard.set(window.testState,'settlement');});
    assert.ok(await page.locator('[data-site-shape="settlement"] path').count()>0);
    results.push({name,...stats});await context.close();
  }
  assert.deepEqual(errors,[]);await writeFile('test-results/building-visual-browser.json',JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({passed:results.length,results},null,2));
}finally{await browser.close();}
