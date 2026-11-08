import {chromium} from 'playwright';
import {PerspectiveCamera,Vector3} from 'three';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {RESOURCES} from '../shared/game.js';
import {openFixture} from './map-first-fixture.js';
import {openStagePanel,closeStagePanel,toggleBoard} from './browser-stage-helpers.js';

// Real-rule protocol fixtures stay on loopback. Independently project the public
// target to catch fixed-screen or wrong-site bubbles in either renderer.
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})}),errors=[],results=[],lifetimesMs=[];
await mkdir('test-results',{recursive:true});await mkdir('docs/screenshots',{recursive:true});
const notice=page=>page.locator('#action-feedback');
async function waitEvent(page,event){await page.waitForFunction(id=>{const el=document.querySelector('#action-feedback');return !el.hidden&&el.dataset.eventIds?.split(',').includes(String(id));},event.id);}
async function camera(page){return page.locator('#board canvas').evaluate(el=>({eye:JSON.parse(el.dataset.camera),target:JSON.parse(el.dataset.cameraTarget||'[0,0,0]'),view:JSON.parse(el.dataset.cameraView||'null')}));}
async function tracking(page){await page.evaluate(()=>{window.bubbleTiming={};const el=document.querySelector('#action-feedback');window.bubbleObserver?.disconnect();window.bubbleObserver=new MutationObserver(()=>{if(!el.hidden&&!window.bubbleTiming.start)window.bubbleTiming.start=performance.now();if(el.hidden&&window.bubbleTiming.start){window.bubbleTiming.duration=performance.now()-window.bubbleTiming.start;window.bubbleObserver.disconnect();}});window.bubbleObserver.observe(el,{attributes:true,attributeFilter:['hidden']});});}
async function expectedAnchor(client,target){
  const {page,game}=client,b=game.board;let anchor;
  if(target.kind==='edge'){const e=b.edges[target.id],a=b.vertices[e.a],c=b.vertices[e.b];anchor={x:(a.x+c.x)/2,y:.45,z:(a.z+c.z)/2};}
  else {const p=(target.kind==='tile'?b.tiles:b.vertices)[target.id];anchor={x:p.x,y:target.kind==='tile'?.6:.65,z:p.z};}
  if(await page.locator('#board>svg').count())return page.locator('#board>svg').evaluate((svg,p)=>{const landscape=svg.clientWidth>svg.clientHeight,point=svg.createSVGPoint();point.x=landscape?p.z*50+300:p.x*50+300;point.y=landscape?-p.x*50+290:p.z*50+290;const screen=point.matrixTransform(svg.getScreenCTM()),rect=svg.parentElement.getBoundingClientRect();return{x:screen.x-rect.x,y:screen.y-rect.y};},anchor);
  const state=await camera(page),bounds=await page.locator('#board canvas').boundingBox(),lens=new PerspectiveCamera(34,bounds.width/bounds.height,.1,150);lens.position.fromArray(state.eye);lens.lookAt(...state.target);if(state.view?.enabled)lens.setViewOffset(state.view.fullWidth,state.view.fullHeight,state.view.offsetX,state.view.offsetY,state.view.width,state.view.height);lens.updateMatrixWorld();const p=new Vector3(anchor.x,anchor.y,anchor.z).project(lens);return{x:(p.x+1)*bounds.width/2,y:(1-p.y)*bounds.height/2};
}
async function anchored(client,event){
  const target=event.targets[0],actual=await notice(client.page).evaluate(el=>({target:el.dataset.target,...JSON.parse(el.dataset.anchor||'{}')}));
  assert.equal(actual.target,`${target.kind}:${target.id}`,'bubble guessed a different map target');const expected=await expectedAnchor(client,target);
  assert.ok(Number.isFinite(actual.x)&&Number.isFinite(actual.y),'bubble has no projection coordinates');assert.ok(Math.hypot(actual.x-expected.x,actual.y-expected.y)<2,`bubble detached from target ${JSON.stringify({actual,expected})}`);
  if(!await client.page.locator('dialog[open]').count()){
    const placement=await notice(client.page).evaluate(el=>{const r=el.getBoundingClientRect(),overlap=b=>Math.max(0,Math.min(r.right,b.right)-Math.max(r.left,b.left))*Math.max(0,Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top));return {visible:getComputedStyle(el).visibility,bounds:r.toJSON(),width:innerWidth,height:innerHeight,blocked:[...document.querySelectorAll('.stage-primary,.stage-utilities,#player-orbit,#play-dock,.hand-tray,#turn-banner>div')].filter(node=>node.getClientRects().length).some(node=>overlap(node.getBoundingClientRect())>1),leader:!document.querySelector('#action-feedback-leader').hasAttribute('hidden')};});
    assert.equal(placement.visible,'visible','action label disappeared instead of finding clear map space');assert.equal(placement.blocked,false,'action label covers HUD');assert.ok(placement.leader,'action label lacks its map leader');assert.ok(placement.bounds.left>=0&&placement.bounds.top>=0&&placement.bounds.right<=placement.width&&placement.bounds.bottom<=placement.height,'action label leaves viewport');
  }
  return actual;
}
async function expires(page,{timed=true}={}){
  await notice(page).waitFor({state:'hidden',timeout:1800});
  assert.ok(await page.locator('#action-feedback-leader').evaluate(el=>el.hasAttribute('hidden')),'map leader stayed after the action notice');
  if(timed){const duration=await page.evaluate(()=>window.bubbleTiming.duration);assert.ok(duration>=1000&&duration<=1500,`bubble lifetime ${duration}ms outside 1–1.5s`);lifetimesMs.push(duration);}
  const targets=await page.locator('#board canvas,#board>svg').evaluate(el=>JSON.parse(el.dataset.feedbackTargets||'[]'));assert.deepEqual(targets,[],'highlight stayed active after the bubble');
}
async function shot(client,name){await client.page.screenshot({path:`test-results/action-feedback-${name}.png`,fullPage:true,scale:'css'});if(['road-3d-1366','robber-2d-667'].includes(name))await client.page.screenshot({path:`docs/screenshots/map-first-bubble-${name}.png`,fullPage:true,scale:'css'});results.push(name);}
try{
  for(const[kind,flat,viewport]of [
    ['road',false,{width:1366,height:768}],['city',false,{width:1920,height:1080}],['robber',false,{width:390,height:844}],['settlement',false,{width:844,height:390}],
    ['road',true,{width:390,height:844}],['city',true,{width:1366,height:768}],['robber',true,{width:667,height:320}],['settlement',true,{width:390,height:844}],
  ]){
    const setup=kind==='settlement',client=await openFixture(browser,{turn:setup?0:1,setup,viewport,touch:viewport.width<1000,errors}),{page}=client;
    if(flat)await toggleBoard(page,'切换二维棋盘');await openStagePanel(page,'openSettings');await page.locator('#auto-follow').uncheck();await closeStagePanel(page);
    assert.equal(await notice(page).isVisible(),false,'hydrate replayed historical events');await tracking(page);let event;
    if(kind==='settlement')event=client.action('p0',{type:'buildSettlement',vertex:client.legal('p0').settlement[0]});
    if(kind==='road')event=client.action('p1',{type:'buildRoad',edge:client.legal('p1').road[0]});
    if(kind==='city')event=client.action('p1',{type:'buildCity',vertex:client.legal('p1').city[0]});
    if(kind==='robber'){const next=structuredClone(client.game);next.phase='robber';next.resumePhase='action';client.set(next,{send:false});event=client.action('p1',{type:'moveRobber',tile:client.legal('p1').robber.at(-1)});}
    await waitEvent(page,event);const first=await anchored(client,event);await shot(client,`${kind}-${flat?'2d':'3d'}-${viewport.width}`);
    const surface=page.locator(flat?'#board>svg':'#board canvas');await surface.focus();await page.keyboard.press('+');await page.waitForTimeout(75);const moved=await anchored(client,event);assert.ok(Math.hypot(first.x-moved.x,first.y-moved.y)>.1,'zoom did not move projected bubble');
    await expires(page);client.publish();client.publish();await page.waitForTimeout(200);assert.equal(await notice(page).isVisible(),false,'duplicate snapshot replayed expired bubble');await client.context.close();
  }
  const client=await openFixture(browser,{turn:1,errors}),{page}=client;await tracking(page);
  const burst=[];for(let i=0;i<2;i++)burst.push(client.action('p1',{type:'buildRoad',edge:client.legal('p1').road[0]},()=>.43,{send:false}));client.publish();await waitEvent(page,burst.at(-1));assert.equal(await notice(page).count(),1,'burst created multiple popups');const ids=(await notice(page).getAttribute('data-event-ids')).split(',');assert.ok(burst.every(e=>ids.includes(String(e.id))),'burst lost event identities');await expires(page);
  await openStagePanel(page,'openChat');await page.locator('#chat-message').fill('行动时继续输入');await page.locator('#chat-message').focus();const before=await camera(page);await tracking(page);const event=client.action('p1',{type:'buildCity',vertex:client.legal('p1').city[0]});await waitEvent(page,event);
  assert.equal(await page.locator('#chat-message').inputValue(),'行动时继续输入');assert.equal(await page.locator('#chat-message').evaluate(el=>el===document.activeElement),true,'feedback stole composing focus');await page.waitForTimeout(300);const after=await camera(page);assert.ok(new Vector3(...before.eye).distanceTo(new Vector3(...after.eye))<.01,'event moved camera while composing');await closeStagePanel(page);await expires(page);
  const top=structuredClone(client.game);top.phase='action';for(const r of RESOURCES){top.bank[r]+=top.players[1].hand[r]-4;top.players[1].hand[r]=4;}client.set(top,{send:false});await tracking(page);const purchase=client.action('p1',{type:'buyDevelopment'});await waitEvent(page,purchase);
  assert.equal(await notice(page).getAttribute('data-target'),'actor:p1','targetless action invented a map location');assert.ok(!/胜利点卡|骑士|垄断|丰收/.test(await notice(page).textContent()),'purchase disclosed a private development card');await shot(client,'actor-development');await expires(page);
  // An event may arrive shortly before the old bubble's cleanup. Its batching
  // timer must survive that cleanup, and a targetless latest action must never
  // borrow the preceding construction's map position.
  const raceFirst=client.action('p1',{type:'buildRoad',edge:client.legal('p1').road[0]});await waitEvent(page,raceFirst);await page.waitForTimeout(1100);
  const raceSecond=client.action('p1',{type:'buildRoad',edge:client.legal('p1').road[0]});await waitEvent(page,raceSecond);await anchored(client,raceSecond);await expires(page,{timed:false});
  client.action('p1',{type:'buildRoad',edge:client.legal('p1').road[0]},()=>.43,{send:false});const latestPurchase=client.action('p1',{type:'buyDevelopment'},()=>.43,{send:false});client.publish();await waitEvent(page,latestPurchase);assert.equal(await notice(page).getAttribute('data-target'),'actor:p1','latest targetless burst action reused an earlier road anchor');await expires(page,{timed:false});
  await page.reload();await page.locator('.playing #board canvas').waitFor();await page.waitForTimeout(200);assert.equal(await notice(page).isVisible(),false,'refresh replayed public history');client.disconnect();await page.waitForTimeout(1400);assert.equal(await notice(page).isVisible(),false,'reconnect replayed public history');await client.context.close();
  const reduced=await openFixture(browser,{turn:1,viewport:{width:390,height:844},touch:true,reducedMotion:'reduce',errors}),rp=reduced.page,initial=await camera(rp);await tracking(rp);
  const reducedEvent=reduced.action('p1',{type:'buildCity',vertex:reduced.legal('p1').city[0]});await waitEvent(rp,reducedEvent);await anchored(reduced,reducedEvent);await rp.waitForTimeout(300);assert.ok(new Vector3(...initial.eye).distanceTo(new Vector3(...(await camera(rp)).eye))<.01,'reduced motion triggered automatic flight');await shot(reduced,'reduced-motion');await expires(rp);await reduced.context.close();
  assert.deepEqual(errors,[]);await writeFile('test-results/action-feedback-results.json',JSON.stringify({scope:'Local Chromium protocol fixtures and viewport/touch simulations',results,lifetimesMs,errors},null,2));console.log(`Action feedback passed: ${results.length} screenshots, edge/vertex/tile projections 2D/3D, zoom tracking, 1–1.5s cleanup, targetless actor anchors, privacy, burst merge, composing focus, refresh/reconnect and reduced motion.`);
}finally{await browser.close();}
