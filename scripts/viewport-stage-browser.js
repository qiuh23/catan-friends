import {withStartingRolls} from '../tests/fixtures/starting-rolls.js';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createGame, addPlayer, act, botAction, viewFor, RESOURCES } from '../shared/game.js';
import { openStagePanel, closeStagePanel, toggleBoard, openEntry } from './browser-stage-helpers.js';

// Rare decision states are loopback-only protocol fixtures. The ordinary smoke
// and multiplayer suites exercise the actual local Node room implementation.
const url=process.env.TEST_URL||'http://127.0.0.1:5175';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})}),errors=[],results=[];
await mkdir('test-results',{recursive:true});
await mkdir('docs/screenshots',{recursive:true});
function fixture(count,setup=false) {
  let seed=17+count,random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  let game=createGame(count>4?{playerExpansion:'five-six-2025'}:{});
  for(let i=0;i<count;i++)addPlayer(game,`p${i}`,['海风','松林','麦田','珊瑚','云杉','砂岩'][i],true);
  game=act(game,'p0',{type:'start'},withStartingRolls(count,random));
  if(!setup) {
    while(game.phase.startsWith('setup-')){const id=game.players[game.turn].id;game=act(game,id,botAction(game,id),random);}
    game.phase='action';game.turn=0;game.turnNo=1;game.dice=[3,5];
    for(const p of game.players)for(const r of RESOURCES)p.hand[r]=p.id==='p0'?4:2;
    for(const r of RESOURCES)game.bank[r]=(count>4?24:19)-game.players.reduce((sum,p)=>sum+p.hand[r],0);
  }
  return game;
}
async function open(count,viewport,{touch=true,insets=null}={}) {
  const context=await browser.newContext({viewport,isMobile:touch,hasTouch:touch,deviceScaleFactor:touch?3:1});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  if(insets)await (await context.newCDPSession(page)).send('Emulation.setSafeAreaInsetsOverride',{insets});
  let game=fixture(count),socket,revision=0,chat=[],paused=false;const actions=[];
  const project=()=>({...viewFor(game,'p0'),chat,room:{hostId:'p0',paused,practice:false,visibility:'private',serverNow:Date.now(),expiresAt:paused?Date.now()+14_400_000:null},players:viewFor(game,'p0').players.map(p=>({...p,online:true}))});
  const publish=()=>socket.send(JSON.stringify({type:'state',revision:++revision,state:project()}));
  await page.route('**/api/deployment',route=>route.fulfill({json:{game:'catan-friends',siteEdition:'global',backendId:'local',publicOrigin:new URL(url).origin}}));
  await page.route('**/api/rooms',route=>route.fulfill({json:route.request().method()==='POST'?{code:'ABC234'}:{rooms:[]}}));
  await page.routeWebSocket('**/api/rooms/*/ws',ws=>{
    socket=ws;ws.onMessage(message=>{
      const m=JSON.parse(message);
      if(m.type==='hello'||m.type==='sync')return publish();
      if(m.type!=='action')return;
      actions.push(m.action);
      try {
        if(m.action.type==='chat')chat=[...chat,{id:`chat-${revision}`,seq:chat.length+1,sentAt:Date.now(),name:'海风',text:m.action.text}];
        else if(m.action.type==='resume')paused=false;
        else game=act(game,'p0',m.action,()=>.43);
        publish();ws.send(JSON.stringify({type:'ack',id:m.id}));
      }catch(error){ws.send(JSON.stringify({type:'error',id:m.id,message:error.message}));}
    });
  });
  await page.goto(url);await openEntry(page);await page.locator('#nickname').fill('海风');await page.getByRole('button',{name:'创建好友房间'}).click();
  await page.locator('.playing #board canvas[data-render-stats]').waitFor();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#board canvas').dataset.renderStats).pieceBuilds>0);
  return {context,page,actions,get game(){return game;},setGame(next){game=next;publish();},setPaused(value){paused=value;publish();},publish,chat(text){chat=[...chat,{id:`peer-${revision}`,seq:chat.length+1,sentAt:Date.now(),name:'松林',text}];publish();}};
}
const settled=page=>page.waitForTimeout(180);
async function fit(page) {
  const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,scrollY}));
  assert.ok(metrics.scrollWidth<=metrics.width+1,`horizontal page overflow: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.scrollHeight<=metrics.height+1,`vertical page overflow: ${JSON.stringify(metrics)}`);
  assert.equal(metrics.scrollY,0,'game page scrolled');
  const board=await page.locator('#board').boundingBox();
  assert.ok(board.x<=1&&board.y<=1&&board.width>=metrics.width-2&&board.height>=metrics.height-2,`board does not fill viewport: ${JSON.stringify({board,metrics})}`);
  const controls=await page.locator('#play-dock button,#stage-tools button,#stage-tools .stage-brand,#hand button,#turn-banner button,.board-controls button').evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>({name:el.getAttribute('aria-label')||el.textContent,rect:el.getBoundingClientRect().toJSON()})));
  for(const {name,rect} of controls) {
    assert.ok(rect.x>=-1&&rect.y>=-1&&rect.right<=metrics.width+1&&rect.bottom<=metrics.height+1,`control outside viewport: ${name} ${JSON.stringify(rect)}`);
    assert.ok(rect.height>=40&&rect.width>=40,`small control: ${name} ${JSON.stringify(rect)}`);
  }
  for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++) {
    const a=controls[i],b=controls[j],overlap=Math.max(0,Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.x,b.rect.x))*Math.max(0,Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.y,b.rect.y));
    assert.ok(overlap<2,`overlapping controls: ${a.name} / ${b.name}`);
  }
  const banner=await page.locator('.turn-banner').boundingBox();
  for(const control of controls.filter(c=>['聊天','玩家','记录','设置','卡坦岛好友桌首页'].includes(c.name))) {
    const rect=control.rect,overlap=Math.max(0,Math.min(banner.x+banner.width,rect.right)-Math.max(banner.x,rect.x))*Math.max(0,Math.min(banner.y+banner.height,rect.bottom)-Math.max(banner.y,rect.y));
    assert.ok(overlap<2,`turn banner overlaps ${control.name}`);
  }
  return {metrics,board};
}
async function snapshot(client,name,{review=false}={}) {
  await settled(client.page);const layout=await fit(client.page),screenshot=`test-results/viewport-${name}.png`;
  await client.page.screenshot({path:screenshot,fullPage:true,scale:'css'});
  if(review)await client.page.screenshot({path:`docs/screenshots/viewport-after-${name.replace(/^6-/,'')}.png`,fullPage:true,scale:'css'});
  results.push({name,viewport:client.page.viewportSize(),...layout,screenshot});
}
async function cameraState(page){return page.locator('#board').evaluate(el=>({bounds:el.getBoundingClientRect().toJSON(),camera:el.querySelector('canvas')?.dataset.camera,view:el.querySelector('canvas')?.dataset.cameraView}));}
function assertSameCamera(actual,expected,message) {
  const {camera:actualPosition,...actualFrame}=actual,{camera:expectedPosition,...expectedFrame}=expected;
  assert.deepEqual(actualFrame,expectedFrame,message);
  const a=JSON.parse(actualPosition),b=JSON.parse(expectedPosition);
  assert.equal(a.length,b.length,message);
  // OrbitControls can round-trip spherical coordinates with sub-ulp noise.
  // Keep bounds and projection exact, and reject any meaningful eye movement.
  for(let i=0;i<a.length;i++)assert.ok(Number.isFinite(a[i])&&Number.isFinite(b[i])&&Math.abs(a[i]-b[i])<=1e-7,`${message}: camera coordinate ${i}: ${a[i]} / ${b[i]}`);
}
async function dialogFits(page) {
  const box=await page.locator('#stage-dialog').boundingBox(),height=await page.evaluate(()=>visualViewport?.height||innerHeight);
  assert.ok(box.y>=-1&&box.y+box.height<=height+1,`dialog clipped: ${JSON.stringify({box,height})}`);
  const close=await page.locator('[data-action="closeStagePanel"]').boundingBox();
  assert.ok(close.y>=box.y&&close.y+close.height<=height+1,'dialog close button clipped');
  await fit(page);
}
try {
  if(process.env.VIEWPORT_PHASE!=='interactions')for(const count of [3,4,5,6])for(const [name,viewport,touch] of [
    ['desktop',{width:1440,height:900},false],['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true],
    ['short-landscape',{width:740,height:320},true],['narrow-landscape',{width:568,height:320},true],['small-portrait',{width:320,height:568},true],
  ]) {
    const client=await open(count,viewport,{touch});
    await snapshot(client,`${count}-${name}`,{review:count===6&&['desktop','portrait','landscape','short-landscape'].includes(name)});
    const camera=await cameraState(client.page);
    for(const action of ['openPlayers','openLog','openSettings','openHand']) {
      await openStagePanel(client.page,action);await dialogFits(client.page);await closeStagePanel(client.page);
      await settled(client.page);assertSameCamera(await cameraState(client.page),camera,`${action} moved or resized map`);
    }
    await client.context.close();
  }
  if(process.env.VIEWPORT_PHASE!=='interactions')console.log('viewport: 24 layouts and 96 overlay open/close cases passed');

  const client=await open(6,{width:390,height:844}),{page}=client;
  await openStagePanel(page,'openChat');await page.locator('#chat-message').fill('保留的聊天草稿');await page.locator('#chat-message').focus();
  await page.locator('#chat-message').evaluate(el=>{window.originalChatInput=el;el.dispatchEvent(new CompositionEvent('compositionstart',{data:'草稿',bubbles:true}));});
  client.chat('收到朋友的新消息');await settled(page);
  assert.equal(await page.locator('#chat-message').inputValue(),'保留的聊天草稿');
  assert.equal(await page.locator('#chat-message').evaluate(el=>el===document.activeElement),true,'incoming state lost chat focus');
  assert.equal(await page.locator('#chat-message').evaluate(el=>el===window.originalChatInput),true,'incoming state replaced a composing chat input');
  await page.locator('#chat-message').evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionend',{data:'草稿',bubbles:true}));delete window.originalChatInput;});
  assert.equal(await page.locator('.chat-bubble>span').last().textContent(),'收到朋友的新消息');
  await closeStagePanel(page);client.chat('聊天气泡与未读提示');await page.locator('.chat-unread').waitFor();
  await openStagePanel(page,'openChat');assert.equal(await page.locator('#chat-message').inputValue(),'保留的聊天草稿');assert.equal(await page.locator('.chat-unread').count(),0,'reading chat did not clear unread indicator');
  // Browser viewport reduction models the space occupied by a system keyboard;
  // it does not establish behavior of an actual phone or keyboard implementation.
  await page.setViewportSize({width:390,height:430});await page.locator('#chat-message').focus();await settled(page);await dialogFits(page);
  const input=await page.locator('#chat-message').boundingBox();assert.ok(input.y>=0&&input.y+input.height<=430,'chat input outside reduced viewport');
  await page.screenshot({path:'test-results/viewport-chat-keyboard-simulation.png',fullPage:true,scale:'css'});
  client.chat('缩小视口后继续输入');await settled(page);assert.equal(await page.locator('#chat-message').inputValue(),'保留的聊天草稿');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'发送消息'}).click();await settled(page);assert.equal(client.actions.at(-1).type,'chat');
  await closeStagePanel(page);

  await page.getByRole('button',{name:'资源交易',exact:true}).click();assert.equal(await page.locator('[data-action="publishTrade"]').isDisabled(),true);
  await page.locator('.exchange-reason').waitFor();assert.equal(client.game.offer,null,'invalid trade changed server state');await dialogFits(page);
  assert.equal(await page.locator('#toast').evaluate(el=>el.classList.contains('show')),false,'modal error also opened an unrelated outside toast');
  await page.locator('.resource-pick[data-side="give"][data-resource="wood"]').click();await page.locator('.resource-pick[data-side="give"][data-resource="wood"]').click();await page.locator('.resource-pick[data-side="want"][data-resource="brick"]').click();
  await closeStagePanel(page);await page.getByRole('button',{name:'资源交易',exact:true}).click();assert.equal(await page.locator('.exchange-body>.exchange-resources:nth-child(2) .exchange-card.wood output').textContent(),'2');
  await page.setViewportSize({width:740,height:320});await settled(page);await dialogFits(page);
  const scroll=await page.locator('#stage-dialog-content').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));
  assert.ok(scroll.scroll<=scroll.height+1||['auto','scroll'].includes(scroll.overflow),'overflowing trade dialog must scroll internally');
  await page.locator('[data-action="publishTrade"]').click();await settled(page);assert.equal(client.actions.at(-1).type,'offerTrade');
  await page.screenshot({path:'test-results/viewport-trade-short-landscape.png',fullPage:true,scale:'css'});await closeStagePanel(page);

  const discard=fixture(6);discard.phase='discard';discard.turn=1;discard.discards={p0:10,p1:5};const beforeDiscard=client.actions.length;client.setGame(discard);
  await page.locator('#stage-dialog[open] #discard-form').waitFor();await dialogFits(page);assert.equal(client.actions.length,beforeDiscard,'discard automatically chosen');
  assert.equal(await page.getByRole('button',{name:'确认弃牌',exact:true}).isDisabled(),true,'incomplete discard can be confirmed');
  await page.locator('#discard-wood').fill('4');assert.match(await page.locator('#discard-form .quantity-summary').textContent(),/4 \/ 10/);
  await page.locator('#discard-wood').fill('4');await page.locator('#discard-brick').fill('4');await page.locator('#discard-wheat').fill('2');
  assert.equal(await page.getByRole('button',{name:'确认弃牌',exact:true}).isEnabled(),true);assert.match(await page.locator('#discard-form .quantity-summary').textContent(),/10 \/ 10/);
  const discardButton=await page.getByRole('button',{name:'确认弃牌',exact:true}).boundingBox();assert.ok(discardButton.y>=0&&discardButton.y+discardButton.height<=320,'discard confirmation hidden in short landscape');
  const discardFooter=await page.locator('#discard-form .decision-submit').boundingBox(),discardInput=await page.locator('#discard-wheat').boundingBox();
  assert.ok(discardInput.y+discardInput.height<=discardFooter.y+1,'discard confirmation covers the focused resource input');
  await page.screenshot({path:'test-results/viewport-discard-short-landscape.png',fullPage:true,scale:'css'});
  await page.keyboard.press('Escape');await page.locator('#stage-dialog[open]').waitFor({state:'hidden'});await page.locator('[data-action="focusTask"]').click();
  assert.equal(await page.locator('#discard-wood').inputValue(),'4','dismiss/reopen lost discard selection');
  client.chat('弃牌时也有消息');await settled(page);assert.equal(await page.locator('#discard-wood').inputValue(),'4');
  await page.setViewportSize({width:390,height:844});await settled(page);await dialogFits(page);await page.screenshot({path:'docs/screenshots/map-first-discard.png',fullPage:true,scale:'css'});
  await page.getByRole('button',{name:'确认弃牌',exact:true}).click();await page.locator('#discard-form').waitFor({state:'hidden'});assert.equal(client.actions.at(-1).type,'discard');

  const trade=fixture(6);trade.turn=1;trade.offer={id:'offer-test',from:'p1',give:{wood:1,brick:0,sheep:0,wheat:0,ore:0},want:{wood:0,brick:1,sheep:0,wheat:0,ore:0}};
  const beforeTrade=client.actions.length;client.setGame(trade);await page.getByRole('button',{name:'资源交易',exact:true}).click();await page.locator('#stage-dialog[open] .current-offer').waitFor();await dialogFits(page);assert.equal(client.actions.length,beforeTrade,'trade automatically accepted');
  await page.screenshot({path:'docs/screenshots/map-first-incoming-trade.png',fullPage:true,scale:'css'});
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'资源交易',exact:true}).click();await page.getByRole('button',{name:'接受并成交'}).click();await page.locator('.current-offer').waitFor({state:'hidden'});assert.equal(client.actions.at(-1).type,'acceptTrade');

  const steal=fixture(6);steal.phase='steal';steal.resumePhase='action';steal.robber=steal.board.tiles.find(t=>t.vertices.some(v=>steal.board.vertices[v].owner&&steal.board.vertices[v].owner!=='p0')).id;
  const beforeSteal=client.actions.length;client.setGame(steal);await page.locator('#stage-dialog[open] [data-victim]').first().waitFor();assert.equal(client.actions.length,beforeSteal,'victim automatically selected');
  await page.screenshot({path:'test-results/viewport-steal.png',fullPage:true,scale:'css'});await page.locator('[data-victim]').first().click();await page.locator('[data-victim]').waitFor({state:'hidden'});assert.equal(client.actions.at(-1).type,'steal');

  const plenty=fixture(6);plenty.players[0].dev=[{id:'plenty-check',type:'plenty',bought:0}];client.setGame(plenty);await openStagePanel(page,'openHand');
  await page.locator('[data-card="plenty-check"]').click();await page.locator('#development-form [id="plenty-wood"]').waitFor();
  assert.equal(await page.getByRole('button',{name:'打出丰收',exact:true}).isDisabled(),true,'empty plenty selection can be confirmed');
  await page.locator('#plenty-wood').fill('1');await page.locator('#plenty-wheat').fill('1');
  assert.equal(await page.locator('#stage-dialog-title').textContent(),'丰收','development dialog has an ambiguous title');
  assert.match(await page.locator('#development-form .quantity-summary').textContent(),/2 \/ 2/);
  await page.screenshot({path:'test-results/viewport-plenty-portrait.png',fullPage:true,scale:'css'});
  await page.setViewportSize({width:740,height:320});await settled(page);await dialogFits(page);
  await page.locator('#plenty-wood').fill('3');assert.equal(await page.getByRole('button',{name:'打出丰收',exact:true}).isDisabled(),true,'overfilled plenty selection can be confirmed');
  await page.locator('#plenty-wood').fill('1');const plentyButton=await page.getByRole('button',{name:'打出丰收',exact:true}).boundingBox();
  assert.ok(plentyButton.y>=0&&plentyButton.y+plentyButton.height<=320,'plenty confirmation hidden in short landscape');
  const plentyFooter=await page.locator('#development-form .decision-submit').boundingBox(),plentyInput=await page.locator('#plenty-wood').boundingBox();
  assert.ok(plentyInput.y+plentyInput.height<=plentyFooter.y+1,'plenty confirmation covers the focused resource input');
  await page.screenshot({path:'test-results/viewport-plenty-short-landscape.png',fullPage:true,scale:'css'});
  await page.getByRole('button',{name:'打出丰收',exact:true}).click();await settled(page);assert.equal(client.actions.at(-1).type,'playDevelopment');
  assert.equal(client.game.players[0].hand.wood,5);assert.equal(client.game.players[0].hand.wheat,5);await closeStagePanel(page);await page.setViewportSize({width:390,height:844});

  client.setGame(fixture(6));client.setPaused(true);await page.locator('#stage-dialog [data-action="resumeGame"]').waitFor();
  assert.equal(await page.locator('#play-dock [data-build="road"]').isDisabled(),false,'cost inspection remains available while execution is paused');await page.locator('#stage-dialog [data-action="resumeGame"]').click();await settled(page);assert.equal(client.actions.at(-1).type,'resume');await closeStagePanel(page);
  await toggleBoard(page,'切换二维棋盘');await page.locator('#board>svg').waitFor();await fit(page);await snapshot(client,'6-flat-portrait');
  const svg=page.locator('#board>svg'),initialBox=await svg.getAttribute('viewBox');
  await svg.focus();await page.keyboard.press('+');assert.notEqual(await svg.getAttribute('viewBox'),initialBox,'2D keyboard zoom did not change view');
  const zoomedBox=await svg.getAttribute('viewBox');await openStagePanel(page,'openSettings');await closeStagePanel(page);assert.equal(await svg.getAttribute('viewBox'),zoomedBox,'2D panel moved map');
  await svg.focus();await page.keyboard.press('0');assert.equal(await svg.getAttribute('viewBox'),initialBox,'2D keyboard reset failed');
  client.setGame(fixture(6,true));await settled(page);const beforeGesture=client.actions.length,gesture=await client.context.newCDPSession(page);
  await gesture.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:360,id:0}]});
  await gesture.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y:385,id:0}]});
  await gesture.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await gesture.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:140,y:360,id:0},{x:230,y:360,id:1}]});
  await gesture.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:110,y:360,id:0},{x:260,y:360,id:1}]});
  await gesture.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(client.actions.length,beforeGesture,'2D drag/pinch accidentally placed a piece');
  await svg.focus();await page.keyboard.press('0');client.setGame(fixture(6));
  await page.setViewportSize({width:844,height:390});await settled(page);await fit(page);await snapshot(client,'6-flat-landscape');
  await toggleBoard(page,'切换三维棋盘');await page.locator('#board canvas[data-render-stats]').waitFor();await fit(page);await client.context.close();
  // CDP overrides the actual CSS env variables; these remain simulated display
  // bands, not verification of a physical notch or browser toolbar.
  for(const [name,viewport,insets] of [
    ['portrait',{width:390,height:844},{top:32,bottom:24,left:0,right:0}],
    ['landscape',{width:667,height:375},{top:0,bottom:21,left:59,right:59}],
  ]) {
    const safe=await open(6,viewport,{insets}),safePage=safe.page;
    await settled(safePage);await fit(safePage);
    const safeTools=await safePage.locator('#stage-tools').boundingBox(),safeDock=await safePage.locator('#play-dock').boundingBox();
    assert.ok(safeTools.y>=insets.top&&safeTools.x>=insets.left&&safeTools.x+safeTools.width<=viewport.width-insets.right&&safeDock.y+safeDock.height<=viewport.height-insets.bottom,'HUD intersects simulated display bands');
    await openStagePanel(safePage,'openChat');await dialogFits(safePage);await safePage.screenshot({path:`test-results/viewport-safe-area-${name}-simulation.png`,fullPage:true,scale:'css'});await safe.context.close();
  }
  assert.deepEqual(errors,[]);await writeFile(`test-results/viewport-stage-${process.env.VIEWPORT_PHASE==='interactions'?'interaction-':''}results.json`,JSON.stringify({environment:{node:process.version,platform:process.platform,chromium:browser.version(),scope:'Chromium desktop and touch/viewport simulations; no physical device verification'},results},null,2)+'\n');
  console.log('viewport: required discard/trade/steal, modal drafts/focus/composing-node identity, invalid-trade feedback, simulated keyboard, 2 CDP safe-area cases, internal scrolling, pause and 2D/3D gestures passed');
} finally {await browser.close();}
