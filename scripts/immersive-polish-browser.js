import {chromium,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {openPolishFixture,polishGame,polishURL} from './immersive-polish-fixture.js';
import {openStagePanel,closeStagePanel,toggleBoard} from './browser-stage-helpers.js';

const errors=[],results=[],engines=process.env.POLISH_ENGINE?[[process.env.POLISH_ENGINE,process.env.POLISH_ENGINE==='webkit'?webkit:chromium]]:[['chromium',chromium],['webkit',webkit]];
await mkdir('test-results/immersive-polish',{recursive:true});
async function shot(page,name){const path=`test-results/immersive-polish/${name}.png`;await page.screenshot({path,fullPage:true,scale:'css'});results.push({name,path});console.log(name);}
async function viewportFits(page,selector){
  const report=await page.evaluate(selector=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,panels:[...document.querySelectorAll('#left-panel,#right-panel')].map(el=>({display:getComputedStyle(el).display,rect:el.getBoundingClientRect().toJSON()})),controls:[...document.querySelectorAll(selector)].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden').map(el=>({name:el.getAttribute('aria-label')||el.textContent,rect:el.getBoundingClientRect().toJSON()}))}),selector);
  assert.ok(report.scrollWidth<=report.width+1&&report.scrollHeight<=report.height+1,`main page scrolls: ${JSON.stringify(report)}`);
  assert.ok(report.panels.every(p=>p.display==='none'||!p.rect.width||!p.rect.height),'large persistent side panel remains');
  for(const c of report.controls)assert.ok(c.rect.left>=-1&&c.rect.top>=-1&&c.rect.right<=report.width+1&&c.rect.bottom<=report.height+1,`control outside viewport: ${JSON.stringify(c)}`);
  return report;
}
async function outside(page,id='#stage-dialog'){
  const point=await page.locator(id).evaluate(el=>{const r=el.getBoundingClientRect();for(const p of [{x:2,y:2},{x:innerWidth-2,y:2},{x:2,y:innerHeight-2},{x:innerWidth-2,y:innerHeight-2}])if(p.x<r.left||p.x>r.right||p.y<r.top||p.y>r.bottom)return p;return null;});
  assert.ok(point,'dialog covers every backdrop corner');await page.mouse.click(point.x,point.y);
}
async function waitPhase(client,phase){await client.page.waitForFunction(phase=>document.querySelector('#table')?.classList.contains(phase==='lobby'?'waiting':'playing'),phase);}

for(const [engine,type] of engines){
  const browser=await type.launch({headless:true});
  try{
    for(const [name,viewport,touch] of (process.env.POLISH_PHASE==='game'?[]:[['desktop',{width:1366,height:768},false],['portrait',{width:390,height:844},true],['short-landscape',{width:667,height:320},true]])){
      const context=await browser.newContext({viewport,hasTouch:touch,isMobile:touch}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(polishURL);await page.locator('#board canvas[data-camera]').waitFor();
      await viewportFits(page,'#home-dock button,.topbar button');await shot(page,`${engine}-home-${name}`);
      await page.locator('[data-action="openEntry"]').click();await page.locator('#nickname').fill('保留昵称');assert.equal(await page.locator('#entry-dialog input[id^="create-count-"]').count(),0,'friend room still asks users to predict count');
      await page.locator('#entry-title').click();assert.ok(await page.locator('#entry-dialog').isVisible(),'inside click dismissed entry');await outside(page,'#entry-dialog');assert.equal(await page.locator('#entry-dialog[open]').count(),0);
      await page.locator('[data-action="openEntry"]').click();assert.equal(await page.locator('#nickname').inputValue(),'保留昵称');await page.locator('#create-friendlyRobber').check();await page.locator('#create-harbormaster').check();await page.locator('#entry-dialog [data-action="practice"]').click();
      await page.locator('label[for="practice-count-6"]').click();assert.ok(await page.locator('#practice-count-6').isChecked());assert.ok(await page.locator('#practice-friendlyRobber').isChecked());await shot(page,`${engine}-practice-config-${name}`);await outside(page,'#practice-dialog');assert.equal(await page.locator('#practice-dialog[open]').count(),0);assert.ok(await page.locator('#entry-dialog').isVisible(),'closing top practice dialog closed underlying entry');
      await page.keyboard.press('Escape');assert.equal(await page.locator('#entry-dialog[open]').count(),0);await context.close();
      for(const count of [3,4,5,6]){
        const client=await openPolishFixture(browser,{count,phase:'lobby',viewport,touch,errors}),p=client.page;
        await waitPhase(client,'lobby');await viewportFits(p,'#play-dock button,#stage-tools button,#player-orbit button');assert.ok(await p.locator('#play-dock [data-action="start"]').isVisible(),'start is hidden');assert.equal(await p.locator('#play-dock [data-action="start"]').isDisabled(),false);
        assert.match(await p.locator('#turn-banner').innerText(),count>4?/5.?6|扩充/:/基础/);await shot(p,`${engine}-lobby-${count}-${name}`);
        if(name==='portrait'){
          await p.locator('#play-dock [data-action="start"]').click();await p.waitForFunction(()=>document.querySelector('#table').classList.contains('playing')&&!document.querySelector('#table').classList.contains('waiting'));
          assert.equal(client.game.board.tiles.length,count>4?30:19);assert.equal(client.game.deck.length,count>4?34:25);assert.equal(client.game.options.friendlyRobber,true);assert.equal(client.game.options.harbormaster,true);
          await viewportFits(p,'#play-dock button,#stage-tools button,#player-orbit button');await shot(p,`${engine}-setup-${count}-${name}`);
          if(count===6){
            await p.locator('#board canvas').focus();await p.keyboard.press('+');await p.waitForTimeout(80);await shot(p,`${engine}-sites-3d-portrait`);
            await toggleBoard(p,'切换二维棋盘');await p.locator('#board>svg').focus();await p.keyboard.press('+');
            await p.locator('#board>svg').evaluate(svg=>{const center={x:innerWidth/2,y:innerHeight/2},sites=[...svg.querySelectorAll('[data-id]')].map(el=>({el,rect:el.getBoundingClientRect()})).filter(({rect:r})=>r.left>10&&r.right<innerWidth-10&&r.top>210&&r.bottom<innerHeight-100);sites.sort((a,b)=>Math.hypot(a.rect.x-center.x,a.rect.y-center.y)-Math.hypot(b.rect.x-center.x,b.rect.y-center.y));sites[0]?.el.focus();});
            await shot(p,`${engine}-sites-2d-portrait`);
          }
        }
        await client.context.close();
      }
    }
    const tooFew=await openPolishFixture(browser,{count:2,phase:'lobby',errors});assert.ok(await tooFew.page.locator('#play-dock [data-action="start"]').isDisabled());await tooFew.context.close();
    for(const practice of [false,true]){
      const client=await openPolishFixture(browser,{count:6,practice,viewport:{width:667,height:320},touch:true,errors}),{page}=client;
      const roomURL=page.url();assert.equal(new URL(roomURL).searchParams.get('room'),'ABC234');
      assert.ok(await page.locator('#stage-tools [data-action="pauseGame"]').isVisible(),'host pause must be directly in HUD');await page.locator('#stage-tools [data-action="pauseGame"]').click();await page.locator('[data-action="confirmRoomDialog"]').click();await page.waitForFunction(()=>document.querySelector('#turn-banner').textContent.includes('暂停'));
      assert.ok(client.paused);assert.equal(await page.locator('#board canvas').getAttribute('data-site-shape'),'');await viewportFits(page,'#stage-tools button,#play-dock button,#player-orbit button');await shot(page,`${engine}-${practice?'practice':'human'}-paused-short-landscape`);
      await page.locator('#stage-dialog [data-action="resumeGame"]').click();await page.waitForFunction(()=>!document.querySelector('#turn-banner').textContent.includes('暂停'));assert.equal(client.paused,false);assert.equal(client.game.phase,'action');
      assert.equal(page.url(),roomURL,'first room overlay cleanup changed the room URL');
      await openStagePanel(page,'openChat');await page.locator('#chat-message').fill('不会丢失的聊天草稿');await page.locator('#stage-dialog-title').click();assert.ok(await page.locator('#stage-dialog').isVisible());await outside(page);assert.equal(await page.locator('#stage-dialog[open]').count(),0);
      await openStagePanel(page,'openChat');assert.equal(await page.locator('#chat-message').inputValue(),'不会丢失的聊天草稿');client.chat('同步的新消息');await page.waitForTimeout(60);assert.equal(await page.locator('#chat-message').inputValue(),'不会丢失的聊天草稿');
      await page.locator('#stage-dialog [data-action="report"]').click();await page.locator('#report-dialog[open]').waitFor();await outside(page,'#report-dialog');assert.ok(await page.locator('#stage-dialog').isVisible(),'closing the top report also closed chat');assert.equal(await page.locator('#chat-message').inputValue(),'不会丢失的聊天草稿');
      await page.goBack();await page.locator('#stage-dialog[open]').waitFor({state:'hidden'});assert.equal(page.url(),roomURL,'system Back lost the current room URL');await openStagePanel(page,'openChat');assert.equal(await page.locator('#chat-message').inputValue(),'不会丢失的聊天草稿','system Back lost chat draft');await closeStagePanel(page);assert.equal(page.url(),roomURL,'closing room dialog returned to a stale URL');
      await page.locator('[data-action="trade"]:visible').click();await page.locator('#give-wood').fill('1');await page.locator('#want-brick').fill('2');await outside(page);assert.equal(client.actions.filter(a=>a.type==='offerTrade').length,0);await page.locator('[data-action="trade"]:visible').click();assert.equal(await page.locator('#give-wood').inputValue(),'1');assert.equal(await page.locator('#want-brick').inputValue(),'2');await closeStagePanel(page);
      client.set(polishGame(6,{phase:'discard'}));await page.locator('#discard-form').waitFor();await page.locator('#discard-wood').fill('2');await outside(page);assert.ok(await page.locator('#discard-form').isVisible(),'required discard disappeared on backdrop');assert.equal(await page.locator('#discard-wood').inputValue(),'2');assert.equal(client.actions.filter(a=>a.type==='discard').length,0);assert.equal(client.game.phase,'discard');await shot(page,`${engine}-${practice?'practice':'human'}-required-discard`);
      await page.keyboard.press('Escape');await page.locator('[data-action="focusTask"]:visible').click();assert.equal(await page.locator('#discard-wood').inputValue(),'2');await client.context.close();
    }
    const peer=await openPolishFixture(browser,{count:4,me:'p1',errors});assert.equal(await peer.page.locator('#stage-tools [data-action="pauseGame"]').count(),0);peer.setPaused(true);await peer.page.waitForTimeout(60);assert.equal(await peer.page.locator('[data-action="resumeGame"]').count(),0);await peer.context.close();
    const result=await openPolishFixture(browser,{count:6,phase:'finished',viewport:{width:390,height:844},touch:true,errors});await result.page.locator('#stage-dialog[open]').waitFor();await shot(result.page,`${engine}-result-portrait`);await result.page.locator('[data-action="rematch"]').click();await waitPhase(result,'lobby');await viewportFits(result.page,'#play-dock button,#stage-tools button,#player-orbit button');assert.equal(result.game.phase,'lobby');assert.equal(result.game.options.friendlyRobber,true);assert.equal(await result.page.locator('#stage-dialog[open]').count(),0,'result dialog remained over the rematch lobby');await shot(result.page,`${engine}-rematch-lobby`);await result.page.locator('#play-dock [data-action="start"]').click();await result.page.waitForFunction(()=>!document.querySelector('#table').classList.contains('waiting'));assert.equal(result.game.phase,'setup-settlement');assert.equal(result.game.board.tiles.length,30);await result.context.close();
  }finally{await browser.close();}
}
assert.deepEqual(errors,[]);await writeFile('test-results/immersive-polish/results.json',JSON.stringify({scope:'Local browser viewport/touch protocol fixtures; no physical phone validation',results,errors},null,2));console.log(`Immersive polish acceptance passed: ${results.length} screenshots, lobby 3–6, phone layouts, automatic maps, drafts/dialogs, required decisions, pause permissions, results/rematch.`);
