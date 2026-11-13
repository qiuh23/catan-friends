import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createGame, addPlayer, viewFor} from '../shared/game.js';
import {openFixture, testURL} from './map-first-fixture.js';

// Manual review of the real root entry. The existing fixture runs the shared
// rules and privacy projection; it does not verify durable room persistence.
// Room-only leave/rematch and delayed chat ACKs are local Playwright adapters,
// never production endpoints or application globals.
const edition=process.env.TEST_EDITION||'global';
const base=new URL(testURL);
assert.equal(base.pathname,'/','TEST_URL must target the formal root entry');
assert.ok(!base.search&&!base.hash,'TEST_URL must not select a review page');
const out='output/playwright/react-migration';
await mkdir(out,{recursive:true});
const errors=[],consoleErrors=[],results=[],screenshots=[];
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
let currentPage;

async function eventually(read, check, label, timeout=10000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) {
    const value=await read();
    if(check(value))return value;
    await new Promise(resolve=>setTimeout(resolve,40));
  }
  assert.fail(label);
}
async function screenshot(page,name) {
  const path=`${out}/${edition}-${name}.png`;
  await page.screenshot({path});screenshots.push(path);
}
async function fits(locator,label) {
  await locator.waitFor({state:'visible'});
  const box=await locator.evaluate(node=>{
    const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,hit:node.contains(hit)};
  });
  assert.ok(box.left>=-1&&box.top>=-1&&box.right<=box.w+1&&box.bottom<=box.h+1,`${label} is clipped`);
  assert.ok(box.hit,`${label} is covered`);
}
async function outside(page,{required=false}={}) {
  const point=await page.locator('#stage-dialog').evaluate(node=>{
    const r=node.getBoundingClientRect();
    return [[2,2],[innerWidth-2,2],[2,innerHeight-2],[innerWidth-2,innerHeight-2]]
      .find(([x,y])=>x<r.left||x>r.right||y<r.top||y>r.bottom);
  });
  assert.ok(point,'No exposed dialog backdrop');
  await page.mouse.click(...point);
  if(required)assert.equal(await page.locator('#stage-dialog').isVisible(),true,'Required decision dismissed by backdrop');
  else await page.locator('#stage-dialog').waitFor({state:'hidden'});
}
async function canvasHandle(page) {
  await page.locator('#board canvas[data-camera]').waitFor();
  return page.locator('#board canvas').elementHandle();
}
async function sameCanvas(page,handle,label) {
  assert.equal(await page.locator('#board canvas').evaluate((node,previous)=>node===previous,handle),true,`${label} replaced the scene canvas`);
}

async function reviewClient(options) {
  const wire={holdChat:false,held:[],helloTokens:[],roomActions:[],snapshots:0};
  let client;
  const instrumentedBrowser={
    async newContext(contextOptions) {
      const context=await browser.newContext(contextOptions),newPage=context.newPage.bind(context);
      context.newPage=async(...args)=>{
        const page=await newPage(...args),route=page.routeWebSocket.bind(page);
        page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
        page.routeWebSocket=(pattern,handler)=>route(pattern,ws=>{
          const send=ws.send.bind(ws),onMessage=ws.onMessage.bind(ws),chatIds=new Set();
          const proxy=new Proxy(ws,{get(target,key){
            if(key==='send')return message=>{
              const envelope=JSON.parse(String(message));
              if(envelope.type==='state') {
                wire.snapshots++;
                assert.ok(envelope.state.players.filter(p=>p.id!==envelope.state.me).every(p=>!('hand'in p)&&!('dev'in p)),'Private opponent cards reached a fixture snapshot');
              }
              if(envelope.type==='ack'&&chatIds.has(envelope.id)&&wire.holdChat)wire.held.push(()=>send(message));
              else send(message);
            };
            if(key==='onMessage')return callback=>onMessage(message=>{
              const envelope=JSON.parse(String(message));
              if(envelope.type==='hello')wire.helloTokens.push(envelope.token);
              if(envelope.type==='action'&&envelope.action.type==='chat')chatIds.add(envelope.id);
              if(envelope.type==='action'&&['leave','rematch'].includes(envelope.action.type)) {
                wire.roomActions.push(envelope.action.type);
                if(envelope.action.type==='rematch') {
                  assert.equal(client.game.phase,'finished');
                  const lobby=createGame(client.game.options);
                  for(const p of client.game.players)addPlayer(lobby,p.id,p.name,p.bot);
                  client.set(lobby);
                }
                send(JSON.stringify({type:'ack',id:envelope.id}));
                return;
              }
              callback(message);
            });
            const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
          }});
          return handler(proxy);
        });
        return page;
      };
      return context;
    },
  };
  client=await openFixture(instrumentedBrowser,{...options,errors});
  return Object.assign(client,{wire,releaseChat(){wire.holdChat=false;wire.held.splice(0).forEach(send=>send());}});
}

async function tradeDrafts(client,label) {
  const p=client.page;
  let canvas=await canvasHandle(p);
  await p.locator('[data-action="trade"]:visible').click();
  const give=p.locator('.resource-pick[data-side="give"][data-resource="wood"]');
  const want=p.locator('.resource-pick[data-side="want"][data-resource="ore"]');
  await give.click();await give.click();await want.click();
  const assertDraft=async()=>{
    assert.equal(await p.locator('.exchange-card.wood output').first().textContent(),'2','Trade payment draft lost');
    assert.equal(await p.locator('.exchange-card.ore output').last().textContent(),'1','Trade receipt draft lost');
  };
  await p.locator('[data-trade-view="bank"]').click();
  await p.locator('[data-bank-side="give"][data-resource="brick"]').click();
  await p.locator('[data-bank-side="want"][data-resource="wheat"]').click();
  await p.locator('[data-trade-view="players"]').click();await assertDraft();
  await p.locator('[data-trade-page="offers"]').click();await p.locator('[data-trade-page="compose"]').click();await assertDraft();
  client.publish();await assertDraft();await sameCanvas(p,canvas,'Trade and public snapshot');
  await screenshot(p,`${label}-trade`);
  await outside(p);await p.locator('[data-action="trade"]:visible').click();await assertDraft();
  await p.reload();await p.locator('.playing #board canvas[data-camera]').waitFor();
  canvas=await canvasHandle(p);
  await p.locator('[data-action="trade"]:visible').click();await assertDraft();
  await p.locator('[data-trade-view="bank"]').click();
  assert.equal(await p.locator('[data-bank-side="give"][data-resource="brick"]').getAttribute('aria-pressed'),'true');
  assert.equal(await p.locator('[data-bank-side="want"][data-resource="wheat"]').getAttribute('aria-pressed'),'true');
  await p.locator('[data-trade-view="players"]').click();await assertDraft();
  await p.locator('[data-action="publishTrade"]').click();
  await p.locator('[data-action="cancelTrade"]').waitFor();
  assert.deepEqual(client.game.offer.give,{wood:2,brick:0,sheep:0,wheat:0,ore:0});
  assert.deepEqual(client.game.offer.want,{wood:0,brick:0,sheep:0,wheat:0,ore:1});
  await sameCanvas(p,canvas,'Published offer');
  await fits(p.locator('[data-action="cancelTrade"]'),'Trade action');
  await p.locator('[data-action="cancelTrade"]').click();
  await p.locator('.exchange-empty').waitFor();
  await outside(p);
  return canvas;
}

async function chatAcknowledgement(client,canvas,label) {
  const p=client.page;
  if(edition==='cn') {
    assert.equal(await p.locator('[data-action="openChat"],#chat-message').count(),0);
    return {disabled:true};
  }
  await p.locator('[data-action="openChat"]:visible').click();
  await p.locator('#chat-message').fill('提交的消息');
  client.wire.holdChat=true;
  await p.locator('#chat-form button').click();
  await eventually(()=>client.wire.held.length,n=>n===1,'Chat ACK was not held');
  assert.equal(await p.locator('#chat-form button').isDisabled(),true);
  await p.locator('#chat-message').fill('确认期间继续编辑的草稿');
  await p.locator('#chat-message').evaluate(node=>node.setSelectionRange(3,7));
  client.chat('对手快照不会打断你的输入');
  await p.locator('#chat-messages').filter({hasText:'对手快照不会打断你的输入'}).waitFor();
  assert.equal(await p.locator('#chat-message').inputValue(),'确认期间继续编辑的草稿');
  assert.deepEqual(await p.locator('#chat-message').evaluate(node=>({focused:document.activeElement===node,start:node.selectionStart,end:node.selectionEnd})),{focused:true,start:3,end:7});
  await sameCanvas(p,canvas,'Chat snapshot');
  client.releaseChat();
  await eventually(()=>p.locator('#chat-form button').isEnabled(),Boolean,'Chat remained busy after ACK');
  assert.equal(await p.locator('#chat-message').inputValue(),'确认期间继续编辑的草稿','Chat ACK erased a new draft');
  await screenshot(p,`${label}-chat`);
  await outside(p);await p.locator('[data-action="openChat"]:visible').click();
  assert.equal(await p.locator('#chat-message').inputValue(),'确认期间继续编辑的草稿');
  await outside(p);await sameCanvas(p,canvas,'Chat close and reopen');
  return {delayedAcknowledgement:true,newDraftRetained:true,focusAndSelectionRetained:true};
}

async function developmentAndDiscard(client,canvas,label) {
  const p=client.page,game=structuredClone(client.game);
  game.phase='action';game.turn=game.primaryTurn=0;game.turnNo=5;game.playedDev=false;
  game.players[0].dev=['plenty','knight','monopoly','roadBuilding','victory'].map((type,i)=>({id:`migration-card-${i}`,type,bought:0}));
  client.set(game);
  await p.locator('[data-action="openHand"][aria-label*="5 张发展卡"]').waitFor();
  await p.locator('[data-action="openHand"]').click();
  assert.equal(await p.locator('.development-hand [data-card]').count(),5);
  assert.equal(await p.locator('[data-card="migration-card-4"]').isDisabled(),true,'Victory card should remain private and automatic');
  await p.locator('[data-card="migration-card-0"]').click();
  await p.locator('#plenty-wood').fill('1');await p.locator('#plenty-brick').fill('1');
  await eventually(()=>p.locator('#development-form .quantity-summary').textContent(),text=>text==='已选 2 / 2 张','Plenty count did not update');
  client.publish();
  assert.equal(await p.locator('#plenty-wood').inputValue(),'1');
  assert.equal(await p.locator('#plenty-brick').inputValue(),'1');
  assert.equal(await p.locator('#development-form button.primary').isEnabled(),true);
  await outside(p);await p.locator('[data-action="openHand"]').click();await p.locator('[data-card="migration-card-0"]').click();
  assert.equal(await p.locator('#plenty-wood').inputValue(),'1');
  await screenshot(p,`${label}-development`);
  await p.locator('#development-form button.primary').click();
  await p.locator('#stage-dialog').waitFor({state:'hidden'});
  assert.equal(client.game.players[0].dev.length,4);
  assert.equal(client.actions.filter(a=>a.type==='playDevelopment').at(-1).cardId,'migration-card-0');
  await sameCanvas(p,canvas,'Development selection and submission');

  const discard=structuredClone(client.game);discard.phase='discard';discard.discards={p0:4};client.set(discard);
  await p.locator('#discard-form').waitFor();
  assert.equal(await p.locator('#discard-form button.primary').isDisabled(),true);
  await p.locator('#discard-wood').fill('2');await p.locator('#discard-brick').fill('1');
  assert.equal(await p.locator('#discard-form button.primary').isDisabled(),true);
  await p.locator('#discard-brick').fill('2');
  assert.equal(await p.locator('#discard-form button.primary').isEnabled(),true);
  await outside(p,{required:true});
  assert.equal(await p.locator('#discard-wood').inputValue(),'2');
  client.publish();assert.equal(await p.locator('#discard-brick').inputValue(),'2');
  await screenshot(p,`${label}-discard`);
  await p.locator('#discard-form button.primary').click();
  await p.locator('#discard-form').waitFor({state:'detached'});
  assert.equal(client.game.phase,'robber');await sameCanvas(p,canvas,'Required discard');
}

async function homeRecovery(client,canvas,label) {
  const p=client.page;
  if(await p.locator('#stage-dialog').isVisible())await outside(p);
  const originalToken=client.wire.helloTokens.at(-1),held=structuredClone(client.game.players[0].hand);
  await p.locator('[data-action="openSettings"]:visible').click();
  await p.locator('#stage-dialog [data-action="home"]').click();
  await p.locator('#room-dialog').waitFor();
  await p.locator('#room-dialog [data-action="cancelRoomDialog"]').last().click();
  await sameCanvas(p,canvas,'Cancelled home navigation');
  await p.locator('#stage-dialog [data-action="home"]').click();
  await p.locator('#room-dialog [data-action="confirmRoomDialog"]').click();
  await p.locator('#home-dock').waitFor({state:'visible'});
  assert.equal(await p.locator('#table').getAttribute('class').then(value=>value.includes('in-room')),false);
  assert.ok(client.wire.roomActions.includes('leave'),'Home navigation did not use the room leave action');
  await screenshot(p,`${label}-home`);
  await p.locator('[data-action="openEntry"]').click();
  await p.locator('[data-action="resume"]').click();
  await p.locator('.playing #board canvas[data-camera]').waitFor();
  assert.ok(client.wire.helloTokens.at(-1)===originalToken,'Original identity was replaced during return');
  assert.deepEqual(client.game.players[0].hand,held,'Home return changed the authoritative hand');
  return canvasHandle(p);
}

async function settlement(client,canvas,label) {
  const p=client.page,finished=structuredClone(client.game);
  finished.phase='finished';finished.winner='p0';finished.discards={};finished.offer=null;
  for(const [i,player] of finished.players.entries())player.dev=Array.from({length:[8,3,2,1][i]},(_,n)=>({id:`final-${i}-${n}`,type:'victory',bought:0}));
  client.set(finished);
  await p.locator('.result-ranking').waitFor();
  await fits(p.locator('.result-actions [data-action="rematch"]'),'Settlement rematch');
  await fits(p.locator('.result-actions [data-action="home"]'),'Settlement return home');
  const expected=viewFor(finished,'p0').players.sort((a,b)=>b.points-a.points);
  const rows=p.locator('.result-ranking li');assert.equal(await rows.count(),expected.length);
  for(const [i,player] of expected.entries()) {
    assert.ok((await rows.nth(i).textContent()).includes(player.name),'Settlement omitted a player');
    assert.equal(await rows.nth(i).locator('strong').textContent(),`${player.points} 分`,'Settlement hid or miscounted final public points');
  }
  await sameCanvas(p,canvas,'Settlement snapshot');await screenshot(p,`${label}-settlement`);
  await rows.last().scrollIntoViewIfNeeded();
  await fits(rows.last(),'Last public ranking row');
  await screenshot(p,`${label}-settlement-ranking`);
  await p.locator('#stage-dialog-content').evaluate(node=>{node.scrollTop=0;});
  await p.locator('[data-action="rematch"]').click();
  await p.locator('#table.waiting').waitFor();
  await fits(p.locator('[data-action="start"]:visible'),'Rematch lobby start');
  assert.equal(client.game.phase,'lobby');assert.equal(client.game.players.length,4);
  await sameCanvas(p,canvas,'Rematch lobby');await screenshot(p,`${label}-room`);
}

try {
  for(const [name,viewport] of [['desktop',{width:1440,height:900}],['portrait',{width:390,height:844}],['landscape',{width:844,height:390}]]) {
    console.log(`[react-migration] ${edition} ${name} ${viewport.width}x${viewport.height}`);
    const client=await reviewClient({count:4,viewport,touch:name!=='desktop'}),p=currentPage=client.page;
    p.setDefaultTimeout(12000);
    await fits(p.locator('[data-action="trade"]:visible'),'Primary trade control');
    await screenshot(p,`${name}-table`);
    await p.locator('[data-build=road]').click();await p.locator('.build-cost').waitFor();
    const selected=await p.locator('#board canvas').getAttribute('data-site-shape');
    await p.mouse.click(viewport.width-4,Math.floor(viewport.height/2));
    await p.locator('.build-cost').waitFor({state:'hidden'});
    assert.equal(await p.locator('#board canvas').getAttribute('data-site-shape'),selected,'Cost dismissal discarded building selection');
    if(selected==='road'){await p.getByRole('button',{name:'取消道路建造',exact:true}).click();assert.equal(await p.locator('#board canvas').getAttribute('data-site-shape'),'','Cancel did not clear placement');}
    let canvas=await tradeDrafts(client,name);
    const chat=await chatAcknowledgement(client,canvas,name);
    await developmentAndDiscard(client,canvas,name);
    canvas=await homeRecovery(client,canvas,name);
    await settlement(client,canvas,name);
    const overflow=await p.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
    assert.ok(overflow.scrollWidth<=overflow.width+1,'Page overflowed horizontally');
    results.push({name,viewport,canvasRetainedThroughUIUpdates:true,costBackdropKeepsSelection:true,tradeDraftSwitchDismissRefresh:true,chat,developmentCountAndSelection:true,requiredDiscardBackdropBlocked:true,
      originalIdentityAndHandRecovery:true,publicFinalRanking:true,settlementActionsInFirstViewport:true,rematchLobby:true,privacyProjectedSnapshots:client.wire.snapshots});
    await client.context.close();currentPage=null;
  }
  assert.deepEqual(errors,[],'Uncaught browser errors');
  assert.deepEqual(consoleErrors,[],'Console errors');
  await writeFile(`${out}/${edition}-report.json`,JSON.stringify({entry:base.origin,scope:'Formal React root, local shared-rule/privacy WebSocket fixtures; room leave/rematch and delayed ACK adapter in test only. Not durable-authority or physical-device verification.',results,screenshots,errors,consoleErrors},null,2)+'\n');
  console.log(JSON.stringify({passed:results.length,errors:errors.length,consoleErrors:consoleErrors.length,report:`${out}/${edition}-report.json`},null,2));
} catch(error) {
  if(currentPage&&!currentPage.isClosed())await screenshot(currentPage,'failure').catch(()=>{});
  await writeFile(`${out}/${edition}-report.json`,JSON.stringify({results,screenshots,errors,consoleErrors,failure:error.stack},null,2)+'\n');
  throw error;
} finally {await browser.close();}
