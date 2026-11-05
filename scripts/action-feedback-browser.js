import { chromium } from 'playwright';
import { PerspectiveCamera, Vector3 } from 'three';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGame, addPlayer, act, botAction, legal, viewFor, RESOURCES } from '../shared/game.js';
import { openStagePanel, closeStagePanel, toggleBoard } from './browser-stage-helpers.js';

// Loopback protocol fixtures exercise infrequent event combinations with the
// real rules and per-player projection. The multiplayer suite covers real Node
// sockets; these fixtures never touch a hosted room or change production data.
const url=process.env.TEST_URL||'http://127.0.0.1:5175';
const browser=await chromium.launch({headless:true}),errors=[],results=[];
await mkdir('test-results',{recursive:true});
function fixture(setup=false) {
  let seed=23;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  let game=createGame({playerExpansion:'five-six-2025'});
  for(let i=0;i<6;i++)addPlayer(game,`p${i}`,['海风','松林','麦田','珊瑚','云杉','砂岩'][i],true);
  game=act(game,'p0',{type:'start'},random);
  if(!setup) {
    while(game.phase.startsWith('setup-')){const id=game.players[game.turn].id;game=act(game,id,botAction(game,id),random);}
    game.phase='action';game.turn=1;game.primaryTurn=1;game.turnNo=2;
    for(const p of game.players)for(const r of RESOURCES)p.hand[r]=p.id==='p1'?4:1;
    for(const r of RESOURCES)game.bank[r]=24-game.players.reduce((sum,p)=>sum+p.hand[r],0);
  }
  return game;
}
async function open({viewport={width:1440,height:900},touch=false,reducedMotion='no-preference',setup=false}={}) {
  const context=await browser.newContext({viewport,hasTouch:touch,isMobile:touch,reducedMotion});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  let game=fixture(setup),socket,revision=0,chat=[];const actions=[];
  const project=()=>{
    const view=viewFor(game,'p0');
    assert.ok(view.players.filter(p=>p.id!=='p0').every(p=>!('hand'in p)&&!('dev'in p)),'fixture leaked hidden cards');
    return {...view,chat,players:view.players.map(p=>({...p,online:true})),room:{hostId:'p0',paused:false,practice:false,visibility:'private',serverNow:Date.now()}};
  };
  const publish=()=>socket?.send(JSON.stringify({type:'state',revision:++revision,state:project()}));
  await page.route('**/api/deployment',route=>route.fulfill({json:{game:'catan-friends',backendId:'local',publicOrigin:new URL(url).origin}}));
  await page.route('**/api/rooms',route=>route.fulfill({json:route.request().method()==='POST'?{code:'ABC234'}:{rooms:[]}}));
  await page.routeWebSocket('**/api/rooms/*/ws',ws=>{
    socket=ws;ws.onMessage(message=>{
      const envelope=JSON.parse(message);
      if(envelope.type==='hello'||envelope.type==='sync')return publish();
      if(envelope.type!=='action')return;
      actions.push(envelope.action);
      try {
        if(envelope.action.type==='chat')chat=[...chat,{id:`chat-${revision}`,name:'海风',text:envelope.action.text}];
        else game=act(game,'p0',envelope.action,()=>.43);
        publish();ws.send(JSON.stringify({type:'ack',id:envelope.id}));
      }catch(error){ws.send(JSON.stringify({type:'error',id:envelope.id,message:error.message}));}
    });
  });
  await page.goto(url);await page.locator('#nickname').fill('海风');await page.getByRole('button',{name:'创建好友房间'}).click();
  await page.locator('.playing #board canvas[data-camera]').waitFor();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#board canvas').dataset.renderStats||'{}').pieceBuilds>0);await settledCamera(page);
  return {page,context,actions,get game(){return game;},publish,
    action(actor,action,random=()=>.43,{send=true}={}){game=act(game,actor,action,random);if(send)publish();return game.presentation?.events.at(-1);},
    set(next,{send=true}={}){game=next;if(send)publish();},
    disconnect(){socket.close({code:1012,reason:'Local reconnect test'});socket=null;},
  };
}
const feedback=page=>page.locator('#action-feedback');
const eventIds=page=>feedback(page).getAttribute('data-event-ids');
async function waitEvent(page,id){await page.waitForFunction(id=>document.querySelector('#action-feedback')?.dataset.eventIds?.split(',').includes(String(id)),String(id));}
async function camera(page){return page.locator('#board canvas').evaluate(canvas=>({eye:JSON.parse(canvas.dataset.camera),target:JSON.parse(canvas.dataset.cameraTarget||'[0,0,0]'),focus:canvas.dataset.cameraFocus||'',view:canvas.dataset.cameraView}));}
async function settledCamera(page){let previous=await camera(page);for(let i=0;i<35;i++){await page.waitForTimeout(100);const next=await camera(page);if(new Vector3(...next.eye).distanceTo(new Vector3(...previous.eye))<.001&&next.focus!=='moving')return next;previous=next;}return previous;}
async function stillCamera(page,before,message){await page.waitForTimeout(900);const after=await camera(page);assert.ok(new Vector3(...after.eye).distanceTo(new Vector3(...before.eye))<.02,`${message}: ${JSON.stringify({before,after})}`);assert.ok(new Vector3(...after.target).distanceTo(new Vector3(...before.target))<.02,`${message}: target changed`);}
async function visibleTarget(client,event) {
  const {page}=client,bounds=await page.locator('#board canvas').boundingBox(),snapshot=await camera(page),view=JSON.parse(snapshot.view||'null');
  const lens=new PerspectiveCamera(34,bounds.width/bounds.height,.1,150);lens.position.fromArray(snapshot.eye);lens.lookAt(...snapshot.target);
  if(view?.enabled)lens.setViewOffset(view.fullWidth,view.fullHeight,view.offsetX,view.offsetY,view.width,view.height);lens.updateMatrixWorld();
  const target=event.targets[0],point=target.kind==='tile'?client.game.board.tiles[target.id]:client.game.board.vertices[target.id];
  const screen=new Vector3(point.x,.5,point.z).project(lens),pixel={x:bounds.x+(screen.x+1)*bounds.width/2,y:bounds.y+(1-screen.y)*bounds.height/2};
  assert.ok(pixel.x>=0&&pixel.y>=0&&pixel.x<=bounds.width&&pixel.y<=bounds.height,`target outside visible map: ${JSON.stringify(pixel)}`);
  const occluders=await page.locator('#camera-toolbar,.stage-utilities,.stage-brand,#turn-banner .turn-banner,#hand .hand-tray,#play-dock,#action-feedback').evaluateAll(elements=>elements.filter(el=>el.getClientRects().length).map(el=>({name:el.id||el.className,box:el.getBoundingClientRect().toJSON()})));
  for(const {name,box}of occluders)assert.ok(!(pixel.x>=box.x&&pixel.x<=box.right&&pixel.y>=box.y&&pixel.y<=box.bottom),`target hidden under ${name}`);
}
async function capture(client,name) {
  const {page}=client;await page.waitForTimeout(150);
  const layout=await page.evaluate(()=>{
    const bounds=selector=>{const el=document.querySelector(selector);return el&&!el.hidden&&el.getClientRects().length?el.getBoundingClientRect().toJSON():null;};
    return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,feedback:bounds('#action-feedback'),toolbar:bounds('#camera-toolbar'),banner:bounds('#turn-banner .turn-banner'),utilities:bounds('.stage-utilities'),dock:bounds('#play-dock'),hand:bounds('#hand .hand-tray')};
  });
  assert.ok(layout.scrollWidth<=layout.width+1,'horizontal overflow');assert.ok(layout.scrollHeight<=layout.height+1,'vertical overflow');
  for(const key of ['feedback','toolbar','dock'])if(layout[key]) {const box=layout[key];assert.ok(box.x>=-1&&box.y>=-1&&box.right<=layout.width+1&&box.bottom<=layout.height+1,`${key} outside viewport: ${JSON.stringify(layout)}`);}
  for(const key of ['toolbar','banner','utilities','dock','hand'])if(layout.feedback&&layout[key]) {
    const a=layout.feedback,b=layout[key],overlap=Math.max(0,Math.min(a.right,b.right)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y));
    assert.ok(overlap<2,`feedback covers ${key}: ${JSON.stringify(layout)}`);
  }
  const path=`test-results/action-feedback-${name}.png`;await page.screenshot({path,fullPage:true,scale:'css'});results.push({name,path,layout});
}
async function city(client,actor='p1') {
  const vertex=legal(client.game,actor).city[0];assert.notEqual(vertex,undefined,'fixture has no city site');
  return client.action(actor,{type:'buildCity',vertex});
}
function production(client) {
  const next=structuredClone(client.game);next.phase='roll';next.turn=1;next.primaryTurn=1;next.pairStep='primary';next.offer=null;
  for(const p of next.players)for(const r of RESOURCES)p.hand[r]=0;
  for(const r of RESOURCES)next.bank[r]=24;
  const productive=next.board.tiles.filter(t=>t.resource!=='desert'&&t.id!==next.robber&&t.vertices.some(id=>next.board.vertices[id].owner));
  const sum=[2,3,4,5,6,8,9,10,11,12].sort((a,b)=>productive.filter(t=>t.number===b).length-productive.filter(t=>t.number===a).length)[0];
  assert.ok(productive.filter(t=>t.number===sum).length>=2,'fixture must produce on multiple tiles');
  client.set(next,{send:false});const dice=[Math.max(1,sum-6),Math.min(6,sum-1)];let index=0;
  return client.action('p1',{type:'roll'},()=>((dice[index++]-1)+.01)/6);
}
try {
  const client=await open(),{page}=client;
  assert.ok(!await feedback(page).isVisible(),'initial hydrate replayed historical feedback');
  await page.locator('#camera-follow').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#camera-follow').getAttribute('aria-pressed'),'false');assert.equal(await page.evaluate(()=>document.activeElement?.id),'camera-follow','keyboard follow toggle lost focus');
  await page.keyboard.press('Enter');assert.equal(await page.locator('#camera-follow').getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>document.activeElement?.id),'camera-follow','keyboard follow restore lost focus');
  const first=await city(client);await waitEvent(page,first.id);
  assert.match(await feedback(page).textContent(),/松林.*城市/);assert.equal(await feedback(page).getAttribute('data-kind'),'city');
  assert.equal(await page.locator('[data-action="locateAction"]').textContent(),'定位','location hint text changed');
  await page.waitForTimeout(1100);await visibleTarget(client,first);await capture(client,'desktop-city');
  const settled=await camera(page),ids=await eventIds(page);client.publish();client.publish();await page.waitForTimeout(350);
  assert.equal(await eventIds(page),ids,'ordinary redraw replayed an event');await stillCamera(page,settled,'duplicate snapshots moved the camera');

  // Interrupt while a new automatic shot is in motion, then retain that manual
  // direction even when another public action arrives or the viewport rotates.
  await page.waitForTimeout(1400);
  const road1=client.action('p1',{type:'buildRoad',edge:legal(client.game,'p1').road[0]});await waitEvent(page,road1.id);
  await page.waitForFunction(()=>document.querySelector('#board canvas').dataset.cameraFocus==='moving');
  await page.mouse.move(700,400);await page.mouse.down();await page.mouse.move(760,425,{steps:5});await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('#camera-toolbar').dataset.followState==='manual');
  const manual=await settledCamera(page);const road2=client.action('p1',{type:'buildRoad',edge:legal(client.game,'p1').road[0]});await waitEvent(page,road2.id);await stillCamera(page,manual,'new event reclaimed a manual camera');
  await page.setViewportSize({width:844,height:390});await page.waitForTimeout(250);const rotated=await camera(page);
  const beforeDirection=new Vector3(...manual.eye).sub(new Vector3(...manual.target)).normalize(),afterDirection=new Vector3(...rotated.eye).sub(new Vector3(...rotated.target)).normalize();
  assert.ok(beforeDirection.dot(afterDirection)>.999,'rotation reset manual observation direction');
  await capture(client,'landscape-manual');

  // Turning follow on is explicit. A two-road burst is one announcement with
  // both locations; arriving events cannot interrupt an open composing dialog.
  await page.locator('[data-action="toggleFollow"]').click();
  const burst=[];for(let i=0;i<2;i++)burst.push(client.action('p1',{type:'buildRoad',edge:legal(client.game,'p1').road[0]},()=>.43,{send:false}));client.publish();
  for(const event of burst)await waitEvent(page,event.id);
  const merged=(await eventIds(page)).split(',');assert.ok(burst.every(event=>merged.includes(String(event.id))),'burst lost an event');
  assert.equal(await page.locator('#action-feedback').count(),1,'burst created multiple popups');
  const robber=structuredClone(client.game);robber.phase='robber';robber.resumePhase='action';client.set(robber,{send:false});
  const robberEvent=client.action('p1',{type:'moveRobber',tile:legal(client.game,'p1').robber.at(-1)});await waitEvent(page,robberEvent.id);
  await page.locator('[data-action="locateAction"]').click();await page.waitForTimeout(800);await visibleTarget(client,robberEvent);
  const toppedUp=structuredClone(client.game);toppedUp.phase='action';toppedUp.turn=1;for(const r of RESOURCES){toppedUp.bank[r]+=toppedUp.players[1].hand[r]-4;toppedUp.players[1].hand[r]=4;}client.set(toppedUp,{send:false});
  await page.waitForTimeout(3600);await openStagePanel(page,'openChat');const fastCloseCamera=await camera(page),fastCloseEvent=await city(client);
  await closeStagePanel(page);await waitEvent(page,fastCloseEvent.id);await stillCamera(page,fastCloseCamera,'event received in a dialog reclaimed view after a fast close');
  await page.waitForTimeout(1000);await openStagePanel(page,'openChat');await page.locator('#chat-message').fill('继续输入草稿');await page.locator('#chat-message').focus();
  const dialogCamera=await camera(page);const productionEvent=production(client);await waitEvent(page,productionEvent.id);await stillCamera(page,dialogCamera,'incoming production moved camera during input');
  assert.equal(await page.locator('#chat-message').inputValue(),'继续输入草稿');assert.equal(await page.locator('#chat-message').evaluate(el=>el===document.activeElement),true,'feedback stole input focus');
  await closeStagePanel(page);await stillCamera(page,dialogCamera,'suppressed event replayed a camera after dialog closure');

  // Multi-place production remains a single public summary and one highlight
  // layer. The screenshot matrix includes short screens and both orientations.
  for(const [name,viewport] of [['portrait',{width:390,height:844}],['landscape-production',{width:844,height:390}],['short-landscape',{width:740,height:320}],['small-portrait',{width:320,height:568}]]) {
    await page.setViewportSize(viewport);await page.locator('[data-action="overview"]').click();const event=production(client);await waitEvent(page,event.id);await page.waitForTimeout(1000);await capture(client,name);
  }
  const publicText=await feedback(page).textContent();assert.ok(!/胜利点卡|手牌|丰收/.test(publicText),'production summary included private state');
  await page.reload();await page.locator('.playing #board canvas[data-camera]').waitFor();await page.waitForTimeout(350);
  assert.ok(!await feedback(page).isVisible(),'refresh replayed historical presentation');
  const beforeReconnect=await camera(page);client.disconnect();const missed=production(client);await page.waitForTimeout(1400);
  assert.ok(!(await eventIds(page)||'').split(',').includes(String(missed.id)),'reconnect replayed offline history');await stillCamera(page,beforeReconnect,'reconnect replayed a historical shot');
  // Keep sending below the flush interval: notices still appear promptly, and
  // the six independent discard submissions share one compact public summary.
  const simultaneous=structuredClone(client.game);simultaneous.phase='roll';simultaneous.turn=1;for(const p of simultaneous.players)for(const r of RESOURCES)p.hand[r]=2;for(const r of RESOURCES)simultaneous.bank[r]=12;
  client.set(simultaneous,{send:false});let die=0;client.action('p1',{type:'roll'},()=>[2.01/6,3.01/6][die++]);
  const discards=[];for(let i=0;i<6;i++){discards.push(client.action(`p${i}`,{type:'discard',cards:{wood:2,brick:2,sheep:1}}));await page.waitForTimeout(90);if(i===2)assert.equal(await feedback(page).isVisible(),true,'continuous event traffic starved feedback');}
  await waitEvent(page,discards.at(-1).id);const discardIds=(await eventIds(page)).split(',');assert.ok(discards.every(event=>discardIds.includes(String(event.id))),'simultaneous discards lost ordering/identity');
  assert.equal(await feedback(page).count(),1,'simultaneous actions opened multiple notices');
  await client.context.close();

  // Static feedback replaces movement for reduced motion. Legal keyboard and
  // touch placement share the unchanged server-rule action path underneath it.
  const reduced=await open({viewport:{width:390,height:844},touch:true,reducedMotion:'reduce'}),rp=reduced.page;
  const reducedCamera=await camera(rp),reducedEvent=await city(reduced);await waitEvent(rp,reducedEvent.id);await stillCamera(rp,reducedCamera,'reduced motion triggered an automatic flight');
  await capture(reduced,'reduced-motion');
  const cdp=await reduced.context.newCDPSession(rp);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:400,id:1},{x:240,y:400,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:130,y:400,id:1},{x:260,y:400,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await rp.waitForFunction(()=>document.querySelector('#camera-toolbar').dataset.followState==='manual');assert.equal(reduced.actions.length,0,'two-finger gesture accidentally submitted an action');
  await openStagePanel(rp,'openSettings');assert.equal(await rp.locator('#reduce-motion').isChecked(),true);await closeStagePanel(rp);
  await reduced.context.close();

  const placement=await open({viewport:{width:390,height:844},touch:true,setup:true}),pp=placement.page;
  await toggleBoard(pp,'切换二维棋盘');await pp.locator('#board [data-id]').first().focus();await pp.keyboard.press('Enter');
  await pp.waitForFunction(()=>document.querySelector('#board svg [data-id]')?.getAttribute('aria-label')?.startsWith('道路'));
  assert.equal(placement.actions.at(-1).type,'buildSettlement');const settlementEvent=placement.game.presentation.events.at(-1);await waitEvent(pp,settlementEvent.id);
  assert.equal(await pp.locator('[data-action="locateAction"]').isDisabled(),true,'location feedback can steal the active placement view');
  await pp.locator('#board > svg').focus();await pp.keyboard.press('+');await pp.waitForFunction(()=>document.querySelector('#camera-toolbar').dataset.followState==='manual');
  await capture(placement,'flat-keyboard-highlight');
  const legalEdge=legal(placement.game,'p0').road;await pp.locator('#board [data-id]').first().tap();await pp.waitForTimeout(300);
  assert.equal(placement.actions.at(-1).type,'buildRoad');assert.ok(legalEdge.includes(placement.actions.at(-1).edge),'feedback changed legal placement');
  await placement.context.close();
  assert.deepEqual(errors,[]);await writeFile('test-results/action-feedback-results.json',JSON.stringify({browser:browser.version(),results,errors},null,2)+'\n');
  console.log('Action feedback browser passed: public events/bursts, manual interruption, input/modal suppression, multi-tile production, refresh/reconnect deduplication, reduced motion, keyboard/touch legal placement, portrait/landscape/short layouts.');
}finally{await browser.close();}
