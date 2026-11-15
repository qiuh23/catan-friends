// Functional DOM acceptance only. No screenshots or visual acceptance.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from '../server/index.js';
const edition=process.argv[2]||'global',domestic=edition==='cn';
const dataDir=await mkdtemp(path.join(os.tmpdir(),'catan-home-alignment-'));
const server=await createServer({port:0,dataDir,siteEdition:edition,botDelay:10000});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const origin=`http://127.0.0.1:${server.port}`;
const errors=[];
async function context(viewport){
  const ctx=await browser.newContext({viewport,reducedMotion:'reduce'});
  await ctx.addInitScript(()=>{localStorage.setItem('catan:graphics-quality','low');Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copied=value;}}});});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));return {ctx,page};
}
async function settled(page){await page.waitForFunction(()=>!document.querySelector('dialog[open]')&&!history.state?.catanOverlay);}
try {
  for(const viewport of [{width:1280,height:800},{width:390,height:844},{width:844,height:390}]){
    const {ctx,page}=await context(viewport);await page.goto(origin);await page.locator('#home-dock').waitFor();
    assert.deepEqual(await page.locator('.home-actions > button').allTextContents(),['创建房间','加入房间','单人练习']);
    assert.equal(await page.locator('.home-actions > button.primary').count(),1);
    assert.equal(await page.locator('#join-form').isVisible(),false);
    assert.ok(await page.locator('#home-dock').evaluate(el=>Boolean(el.querySelector('.home-actions').compareDocumentPosition(el.querySelector('.public-rooms'))&Node.DOCUMENT_POSITION_FOLLOWING)));
    const url=page.url(),historyLength=await page.evaluate(()=>history.length);
    await page.locator('[data-action="toggleJoin"]').click();assert.equal(page.url(),url);assert.equal(await page.evaluate(()=>history.length),historyLength);
    assert.equal(await page.locator('dialog[open]').count(),0);await page.locator('#join-code').fill('bad');
    if(!domestic)await page.locator('#join-nickname').fill('测试好友');
    await page.locator('#join-form button[type="submit"]').click();assert.equal(await page.locator('.pregame-topbar').count(),0);
    await page.locator('[data-action="toggleJoin"]').click();await page.locator('[data-action="toggleJoin"]').click();assert.equal(await page.locator('#join-code').inputValue(),'bad');
    await page.locator('[data-action="toggleJoin"]').click();
    for(const mode of ['escape','close','mask']){
      await page.locator('.topbar [data-action="rules"]').click();await page.locator('#rules-dialog[open]').waitFor();
      assert.equal(await page.locator('#rules-dialog h2').textContent(),'玩法规则');
      if(mode==='escape')await page.keyboard.press('Escape');else if(mode==='close')await page.locator('[data-action="closeRules"]').click();else await page.mouse.click(1,1);
      await settled(page);assert.equal(page.url(),url);
    }
    await page.locator('[data-action="openEntry"]').click();
    if(!domestic)await page.locator('#nickname').fill('房主测试');
    await page.locator('#create-visibility').selectOption('private');await page.locator('label[for="create-friendlyRobber"]').click();
    await page.locator('[data-action="closeEntry"]').click();await settled(page);await page.locator('[data-action="openEntry"]').click();
    assert.equal(await page.locator('#create-visibility').inputValue(),'private');assert.equal(await page.locator('#create-friendlyRobber').isChecked(),true);
    await page.locator('#create-room').click();await page.locator('.pregame-topbar').waitFor();
    assert.deepEqual(await page.locator('.pregame-topbar button').evaluateAll(ns=>ns.map(n=>n.dataset.action)),['copyRoomCode','invite','home']);
    const identity=await page.evaluate(()=>JSON.parse(localStorage.getItem('catan:last')));
    const expectedCode=identity.code;
    await page.locator('.pregame-topbar [data-action="copyRoomCode"]').click();assert.equal(await page.evaluate(()=>window.copied),expectedCode);
    await page.locator('.pregame-topbar [data-action="invite"]').click();const invitation=await page.evaluate(()=>window.copied);assert.ok(invitation.startsWith(origin));
    const guest=await context(viewport);await guest.page.goto(invitation);await guest.page.locator('#join-form').waitFor();assert.equal(await guest.page.locator('#join-code').inputValue(),expectedCode);
    if(!domestic)await guest.page.locator('#join-nickname').fill('加入测试');
    await guest.page.locator('#join-form button[type="submit"]').click();await guest.page.locator('.pregame-topbar').waitFor();
    assert.equal(await guest.page.locator('[data-action="openChat"]').count(),domestic?0:1);
    await guest.page.locator('.pregame-topbar [data-action="home"]').click();await guest.page.locator('[data-action="cancelRoomDialog"]').first().click();await settled(guest.page);assert.equal(await guest.page.locator('.pregame-topbar').count(),1);
    await guest.page.locator('.pregame-topbar [data-action="home"]').click();await guest.page.locator('[data-action="confirmRoomDialog"]').click();await guest.page.locator('#home-dock').waitFor();
    await guest.ctx.close();
    await page.locator('[data-action="addBot"]').click();await page.waitForFunction(()=>document.querySelectorAll('.player-circle').length===2);
    await page.locator('[data-action="addBot"]').click();await page.waitForFunction(()=>document.querySelectorAll('.player-circle').length===3);
    assert.equal((await page.locator('[data-action="start"]').textContent()).trim(),'开始游戏');
    await page.locator('[data-action="start"]').click();await page.locator('.turn-banner').waitFor();assert.equal(await page.locator('.pregame-topbar').count(),0);await ctx.close();
    const practice=await context(viewport);await practice.page.goto(origin);await practice.page.locator('[data-action="homePractice"]').click();await practice.page.locator('#practice-dialog[open]').waitFor();
    if(!domestic)await practice.page.locator('#practice-nickname').fill('练习测试');
    await practice.page.locator('label[for="practice-count-3"]').click();await practice.page.locator('#practice-start').click();await practice.page.locator('.turn-banner').waitFor();assert.equal(await practice.page.locator('.player-circle').count(),3);await practice.ctx.close();
    console.log(`${edition} ${viewport.width}x${viewport.height}: DOM order, inline join, drafts, rules dismissal, create/invite/copy/join/leave/start and practice passed.`);
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();await server.close();await rm(dataDir,{recursive:true,force:true});}
