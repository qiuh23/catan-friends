import { chromium } from 'playwright';
import { Vector3 } from 'three';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGame, addPlayer, act, botAction, viewFor, RESOURCES } from '../shared/game.js';
import { boardCamera, toggleBoard, openStagePanel, closeStagePanel, openEntry } from './browser-stage-helpers.js';

// These loopback-only fixtures exercise rare UI states without changing a live
// game or exposing another player's hand. Actual room flows have separate tests.
const url=process.env.TEST_URL||'http://127.0.0.1:5175';
const browser=await chromium.launch({headless:true}),errors=[],results=[];
await mkdir('test-results',{recursive:true});
function fixture(count,setup=false) {
  let seed=17+count,random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  let game=createGame(count>4?{playerExpansion:'five-six-2025'}:{});
  for(let i=0;i<count;i++)addPlayer(game,`p${i}`,['海风','松林','麦田','珊瑚','云杉','砂岩'][i],true);
  game=act(game,'p0',{type:'start'},random);
  if(!setup) {
    while(game.phase.startsWith('setup-')){const id=game.players[game.turn].id;game=act(game,id,botAction(game,id),random);}
    game.phase='action';game.turn=0;game.turnNo=1;game.dice=[3,5];
    for(const p of game.players)for(const r of RESOURCES)p.hand[r]=p.id==='p0'?4:2;
    for(const r of RESOURCES)game.bank[r]=(count>4?24:19)-game.players.reduce((sum,p)=>sum+p.hand[r],0);
  }
  return game;
}
async function open(count,viewport,{touch=true,setup=false}={}) {
  const context=await browser.newContext({viewport,isMobile:touch,hasTouch:touch,deviceScaleFactor:touch?3:1});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  let game=fixture(count,setup),socket,revision=0,chat=[];const actions=[];
  const project=()=>({...viewFor(game,'p0'),chat,room:{hostId:'p0',paused:false,practice:false,visibility:'private',serverNow:Date.now()},players:viewFor(game,'p0').players.map(p=>({...p,online:true}))});
  const publish=()=>socket.send(JSON.stringify({type:'state',revision:++revision,state:project()}));
  await page.route('**/api/deployment',route=>route.fulfill({json:{game:'catan-friends',backendId:'local',publicOrigin:new URL(url).origin}}));
  await page.route('**/api/rooms',route=>route.fulfill({json:route.request().method()==='POST'?{code:'ABC234'}:{rooms:[]}}));
  await page.routeWebSocket('**/api/rooms/*/ws',ws=>{
    socket=ws;ws.onMessage(message=>{
      const m=JSON.parse(message);
      if(m.type==='hello'||m.type==='sync')return publish();
      if(m.type!=='action')return;
      actions.push(m.action);
      try {
        if(m.action.type==='chat')chat=[...chat,{id:`chat-${revision}`,name:'海风',text:m.action.text}];
        else game=act(game,'p0',m.action,()=>.43);
        publish();ws.send(JSON.stringify({type:'ack',id:m.id}));
      }catch(error){ws.send(JSON.stringify({type:'error',id:m.id,message:error.message}));}
    });
  });
  await page.goto(url);await openEntry(page);await page.locator('#nickname').fill('海风');await page.getByRole('button',{name:'创建好友房间'}).click();
  await page.locator('.playing #board canvas[data-render-stats]').waitFor();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#board canvas').dataset.renderStats).pieceBuilds>0);
  return {context,page,actions,get game(){return game;},setGame(next){game=next;publish();},publish,chat(text){chat=[...chat,{id:`peer-${revision}`,name:'松林',text}];publish();}};
}
async function stats(page){return JSON.parse(await page.locator('#board canvas').getAttribute('data-render-stats'));}
async function settled(page){await page.waitForTimeout(180);}
async function ready(client){
  await client.page.locator('#board[aria-busy="false"]').waitFor();
  // The new HUD and its off-axis camera projection settle after the state/ack.
  await client.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function received(client,type){
  const deadline=Date.now()+5000;
  while(client.actions.at(-1)?.type!==type&&Date.now()<deadline)await client.page.waitForTimeout(25);
  assert.equal(client.actions.at(-1)?.type,type,'expected actual protocol action');
}
async function fits(page) {
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
  const rect=await page.locator('#board canvas').boundingBox();assert.ok(rect.width>=230&&rect.height>=120,`board too small: ${JSON.stringify(rect)}`);
  const dock=await page.locator('#play-dock').boundingBox();
  assert.ok(dock.y+dock.height<=await page.evaluate(()=>innerHeight)+2,'turn controls leave the viewport');
  const sizes=await page.locator('.board-controls button,#play-dock button').evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>el.getBoundingClientRect().height));
  assert.ok(sizes.every(h=>h>=44),'small touch control');
}
async function capture(client,name) {
  await settled(client.page);await fits(client.page);
  if(client.page.viewportSize().width<client.page.viewportSize().height){
    const [x,y,z]=JSON.parse(await client.page.locator('#board canvas').getAttribute('data-camera'));
    assert.ok(y>Math.hypot(x,z)*2,'portrait game inherited the low landscape preview pitch');
  }
  const metrics=await stats(client.page);assert.ok(metrics.calls<=100,`draw call budget: ${metrics.calls}`);assert.ok(metrics.triangles<=(metrics.shadows?45000:25000),`triangle budget: ${metrics.triangles}`);
  const screenshot=`test-results/terrain-${name}.png`;await client.page.screenshot({path:screenshot,fullPage:true});
  if(process.env.SAVE_REVIEW_SHOTS==='1'&&['6-desktop','6-portrait','6-landscape'].includes(name)) {
    await mkdir('test-results/review',{recursive:true});
    await client.page.screenshot({path:`test-results/review/terrain-${name.slice(2)}.png`,scale:'css'});
  }
  if(!results.length) {
    const renderer=await client.page.locator('#board canvas').evaluate(canvas=>{
      const gl=canvas.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
      return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    });
    await writeFile('test-results/terrain-environment.json',JSON.stringify({node:process.version,platform:process.platform,chromium:browser.version(),renderer},null,2)+'\n');
  }
  results.push({name,viewport:client.page.viewportSize(),...metrics,screenshot});
}
async function point(page,position) {
  const bounds=await page.locator('#board canvas').boundingBox();
  const camera=await boardCamera(page,bounds);
  const p=new Vector3(position.x,position.y??.39,position.z).project(camera);
  return {x:bounds.x+(p.x+1)*bounds.width/2,y:bounds.y+(1-p.y)*bounds.height/2};
}
try {
  for(const count of [3,4,5,6])for(const [name,viewport,touch] of [
    ['desktop',{width:1440,height:960},false],['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true],
  ]) {
    const client=await open(count,viewport,{touch});await capture(client,`${count}-${name}`);
    const measured=await stats(client.page);assert.equal(measured.shadows,!touch);if(touch)assert.ok(measured.dpr<=1.35);
    await client.context.close();
  }
  for(const [name,viewport,count=6,touch=true] of [
    ['6-small-portrait',{width:320,height:568}],['6-small-landscape',{width:667,height:375}],['6-tablet',{width:768,height:1024}],['3-small-desktop',{width:1280,height:720},3,false],
  ]){const client=await open(count,viewport,{touch});await capture(client,name);await client.context.close();}

  console.log('terrain: layouts and rendering budgets passed');
  const client=await open(6,{width:390,height:844}),{page}=client;
  await settled(page);const before=await stats(page);
  client.chat('检查普通消息不会重建棋盘');await page.locator('.chat-unread').waitFor();await settled(page);
  const after=await stats(page);assert.deepEqual(after,before,'ordinary chat scheduled a render or rebuilt a layer');
  await page.waitForTimeout(500);assert.deepEqual(await stats(page),after,'idle board keeps rendering');
  const handChange=structuredClone(client.game);handChange.players[0].hand.ore--;handChange.bank.ore++;client.setGame(handChange);await settled(page);
  assert.deepEqual(await stats(page),after,'ordinary hand update rebuilt or rendered the board');
  client.setGame(fixture(6));await settled(page);
  await openStagePanel(page,'openChat');await page.locator('#chat-message').fill('自己的消息和忙碌状态也不重建棋盘');
  await page.getByRole('button',{name:'发送消息'}).click();await settled(page);assert.deepEqual(await stats(page),after,'chat send/ack rebuilt or rendered the board');
  await page.locator('#chat-message').fill('保留的草稿');
  client.chat('继续保留输入和视角');await settled(page);assert.equal(await page.locator('#chat-message').inputValue(),'保留的草稿');
  await closeStagePanel(page);await page.evaluate(()=>scrollTo(0,0));

  // Discard must be visible even when another player owns this turn.
  const discard=structuredClone(client.game);discard.phase='discard';discard.turn=1;discard.discards={p0:10,p1:5};client.setGame(discard);
  await page.locator('.turn-banner:visible strong').filter({hasText:'请弃掉 10 张资源'}).waitFor();await page.locator('#discard-form').waitFor();
  await page.locator('#discard-wood').fill('4');await page.locator('#discard-brick').fill('4');await page.locator('#discard-wheat').fill('2');
  client.chat('弃牌时有消息');await settled(page);assert.equal(await page.locator('#discard-wood').inputValue(),'4');
  await page.setViewportSize({width:844,height:390});await settled(page);
  assert.equal(await page.locator('#discard-wood').inputValue(),'4');
  await page.screenshot({path:'test-results/terrain-off-turn-discard-landscape.png',fullPage:true});
  await page.getByRole('button',{name:'确认弃牌',exact:true}).click();await page.locator('#discard-form').waitFor({state:'hidden'});
  assert.equal(client.actions.at(-1).type,'discard');

  const trade=fixture(6);trade.turn=1;trade.offer={id:'offer-test',from:'p1',give:{wood:1,brick:0,sheep:0,wheat:0,ore:0},want:{wood:0,brick:1,sheep:0,wheat:0,ore:0}};client.setGame(trade);
  await page.locator('.turn-banner:visible strong').filter({hasText:'收到一笔交易报价'}).waitFor();await page.getByRole('button',{name:'接受这笔交易'}).waitFor();
  await page.screenshot({path:'test-results/terrain-trade-landscape.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await settled(page);await page.screenshot({path:'test-results/terrain-trade-portrait.png',fullPage:true});
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'去处理',exact:true}).click();assert.equal(await page.locator('#decision-panel').evaluate(el=>el===document.activeElement||el.contains(document.activeElement)),true);
  await page.getByRole('button',{name:'接受这笔交易'}).click();await page.locator('.trade-offer').waitFor({state:'hidden'});
  assert.equal(client.actions.at(-1).type,'acceptTrade');

  // Simulated keyboard viewport: keep input drafts and focused controls reachable.
  client.setGame(fixture(6));await page.getByRole('button',{name:'资源交易',exact:true}).click();await page.locator('#give-wood').fill('2');
  await page.setViewportSize({width:390,height:430});await settled(page);assert.equal(await page.locator('#give-wood').inputValue(),'2');
  await page.locator('#give-wood').focus();await settled(page);
  const focused=await page.locator('#give-wood').boundingBox();assert.ok(focused.y>=0&&focused.y+focused.height<=430);
  client.chat('模拟键盘收起前的消息');assert.equal(await page.locator('#give-wood').inputValue(),'2');
  await page.setViewportSize({width:390,height:844});await closeStagePanel(page);await page.evaluate(()=>scrollTo(0,0));

  // Repeated switches should keep one canvas, bounded GPU resources, and camera fit.
  for(let i=0;i<5;i++) {
    await page.evaluate(()=>{window.previousBoardContext=document.querySelector('#board canvas').getContext('webgl2');});
    await toggleBoard(page,'切换二维棋盘');await page.locator('#board>svg').waitFor();assert.equal(await page.locator('#board canvas').count(),0);
    await page.waitForFunction(()=>window.previousBoardContext.isContextLost());await page.evaluate(()=>{delete window.previousBoardContext;});
    await toggleBoard(page,'切换三维棋盘');await page.locator('#board canvas[data-render-stats]').waitFor();await settled(page);
    // Two shared silhouette geometries distinguish village/city build sites.
    const metrics=await stats(page);assert.ok(metrics.geometries<=12&&metrics.textures<=17,'GPU resources grow across switches');assert.equal(await page.locator('#board canvas').count(),1);
  }
  const restored=await stats(page);results.push({name:'switch-cycle',...restored});
  // The game page itself is intentionally fixed; simulate offscreen visibility
  // by moving the stage instead of manufacturing a scrollable game document.
  await page.evaluate(()=>{document.querySelector('#table').style.transform='translateY(-2000px)';});
  await settled(page);const offscreen=await stats(page);assert.ok(await page.locator('#board canvas').evaluate(el=>el.getBoundingClientRect().bottom<0));
  const moved=fixture(6);moved.robber=(moved.robber+1)%moved.board.tiles.length;client.setGame(moved);await settled(page);
  assert.equal((await stats(page)).renders,offscreen.renders,'offscreen board rendered');
  await page.evaluate(()=>{document.querySelector('#table').style.transform='';});
  await page.waitForFunction(r=>JSON.parse(document.querySelector('#board canvas').dataset.renderStats).renders>r,offscreen.renders);
  assert.equal((await stats(page)).landBuilds,restored.landBuilds,'robber move rebuilt terrain');
  assert.equal((await stats(page)).pieceBuilds,restored.pieceBuilds+1);
  await client.context.close();
  console.log('terrain: off-turn tasks, offers, drafts, rotation, simulated keyboard, idle/chat and switch lifecycle passed');

  const touch=await open(6,{width:390,height:844},{setup:true});
  const legal=viewFor(touch.game,'p0').legal.settlement;
  const centers=await Promise.all(legal.map(id=>point(touch.page,touch.game.board.vertices[id])));
  let nearest={distance:Infinity};
  for(let i=0;i<centers.length;i++)for(let j=i+1;j<centers.length;j++) {
    const distance=Math.hypot(centers[i].x-centers[j].x,centers[i].y-centers[j].y);
    if(distance<nearest.distance)nearest={distance,a:centers[i],b:centers[j]};
  }
  assert.ok(nearest.distance<44,'fixture has no adjacent touch regions');
  await touch.page.touchscreen.tap((nearest.a.x+nearest.b.x)/2,(nearest.a.y+nearest.b.y)/2);
  assert.equal(touch.actions.length,0,'ambiguous tap placed a piece');
  assert.match(await touch.page.locator('#tile-hint').textContent(),/放大/);
  const gesture=await touch.context.newCDPSession(touch.page);
  const center=centers[0];
  await gesture.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:center.x,y:center.y,id:0}]});
  await gesture.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:center.x+35,y:center.y+20,id:0}]});
  await gesture.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(touch.actions.length,0,'drag placed a piece');
  await gesture.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:160,y:230,id:0},{x:200,y:230,id:1}]});
  await gesture.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:150,y:230,id:0},{x:210,y:230,id:1}]});
  await gesture.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(touch.actions.length,0,'pinch placed a piece');
  await openStagePanel(touch.page,'openSettings');await touch.page.getByRole('button',{name:'复位棋盘视角'}).click();await closeStagePanel(touch.page);await settled(touch.page);
  await ready(touch);
  const site=touch.game.board.vertices[viewFor(touch.game,'p0').legal.settlement[0]],p=await point(touch.page,site);
  await touch.page.touchscreen.tap(p.x,p.y);await touch.page.waitForFunction(()=>document.querySelector('.turn-banner')?.textContent.includes('铺设起始道路'));
  assert.equal(touch.actions.at(-1).type,'buildSettlement');assert.equal(touch.actions.at(-1).vertex,site.id);
  await ready(touch);
  const state=viewFor(touch.game,'p0'),edge=state.board.edges[state.legal.road[0]],a=state.board.vertices[edge.a],b=state.board.vertices[edge.b];
  const road=await point(touch.page,{x:(a.x+b.x)/2,z:(a.z+b.z)/2});await touch.page.touchscreen.tap(road.x,road.y);await received(touch,'buildRoad');
  assert.equal(touch.actions.at(-1).type,'buildRoad');assert.equal(touch.actions.at(-1).edge,edge.id);
  await touch.page.screenshot({path:'test-results/terrain-touch-six-setup.png',fullPage:true});
  touch.setGame(fixture(6));await touch.page.locator('[data-build="city"]').click();await ready(touch);
  const cityId=viewFor(touch.game,'p0').legal.city[0],city=await point(touch.page,touch.game.board.vertices[cityId]);
  await touch.page.touchscreen.tap(city.x,city.y);await received(touch,'buildCity');await ready(touch);
  const robber=fixture(6);robber.phase='robber';touch.setGame(robber);await settled(touch.page);await ready(touch);
  const tileId=viewFor(robber,'p0').legal.robber[0],tile=robber.board.tiles[tileId],tilePoint=await point(touch.page,{...tile,y:.28});
  await touch.page.touchscreen.tap(tilePoint.x,tilePoint.y);await received(touch,'moveRobber');assert.equal(touch.actions.at(-1).tile,tileId);await ready(touch);
  touch.setGame(fixture(6,true));await toggleBoard(touch.page,'切换二维棋盘');await ready(touch);await touch.page.locator('#board [data-id]').first().tap();await received(touch,'buildSettlement');await ready(touch);
  assert.equal(touch.actions.at(-1).type,'buildSettlement');
  await touch.page.locator('#board [data-id]').first().focus();await touch.page.keyboard.press('Enter');await received(touch,'buildRoad');
  await touch.context.close();
  // Losing 3D availability keeps the playable, keyboard-accessible fallback.
  const fallback=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await fallback.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){return /^webgl/.test(kind)?null:original.call(this,kind,...args);};
  });
  const fallbackPage=await fallback.newPage();fallbackPage.on('pageerror',e=>errors.push(e.message));await fallbackPage.goto(url);
  await fallbackPage.locator('#board>svg').waitFor();assert.equal(await fallbackPage.locator('#board canvas').count(),0);
  await fallbackPage.getByRole('button',{name:'切换三维棋盘'}).waitFor();await fallback.close();
  assert.deepEqual(errors,[]);await writeFile('test-results/terrain-performance.json',JSON.stringify(results,null,2)+'\n');
  console.log('terrain: 3–6 players, 16 layout cases, 3D touch settlement/road, budgets and task matrix passed');
} finally {await browser.close();}
