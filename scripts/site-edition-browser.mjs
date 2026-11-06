import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from '../server/index.js';
import { NICKNAMES } from '../shared/site-policy.js';

const edition=process.argv[2]||'cn',domestic=edition==='cn';
const dataDir=await mkdtemp(path.join(os.tmpdir(),'catan-browser-'));
const app=await createServer({port:0,dataDir,siteEdition:edition,botDelay:10000});
const browser=await chromium.launch({headless:true});
await mkdir('test-results/site-edition',{recursive:true});
try{
  for(const viewport of [{width:1280,height:800},{width:844,height:390}]){
    const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{localStorage.setItem('catan:name',JSON.stringify('旧自由昵称'));localStorage.setItem('siteEdition','global');sessionStorage.setItem('catan:drafts:home',JSON.stringify([['nickname','旧昵称'],['chat-message','旧聊天']]));});
    await page.goto(`http://127.0.0.1:${app.port}/?edition=global&backend=cloudflare`);
    await page.locator('[data-action="openEntry"]').click();
    if(domestic){
      assert.equal(await page.locator('#nickname').count(),0);assert.equal(await page.locator('[data-action="report"],#report-dialog').count(),0);
      const before=await page.locator('#fixed-nickname').textContent();assert.ok(NICKNAMES.some(n=>n.name===before));
      await page.locator('[data-action="newNickname"]').click();assert.notEqual(await page.locator('#fixed-nickname').textContent(),before);
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('catan:name'))),null);
    }else await page.locator('#nickname').fill('海外自定义');
    await page.screenshot({path:`test-results/site-edition/${edition}-${viewport.width}-entry.png`});
    await page.locator('#create-room').click();await page.locator('.waiting-banner').waitFor();
    assert.equal(await page.locator('[data-action="openChat"]').count(),domestic?0:1);
    assert.equal(await page.locator('#chat-form,.chat-unread,#chat-messages').count(),0);
    if(domestic){assert.equal(await page.locator('[data-action="newNickname"]').isVisible(),false);assert.ok(NICKNAMES.map(n=>n.name).includes(await page.locator('.circle-face').textContent()));}
    else{
      await page.locator('[data-action="openChat"]').click();await page.locator('#chat-message').fill('海外聊天保留');await page.locator('#chat-form button').click();await page.locator('#chat-messages').getByText('海外聊天保留',{exact:true}).waitFor();await page.locator('[data-action="closeStagePanel"]').click();
    }
    await page.locator('[data-action="addBot"]').click();await page.waitForFunction(()=>document.querySelectorAll('.player-circle').length===2);
    await page.locator('[data-action="addBot"]').click();await page.waitForFunction(()=>document.querySelectorAll('.player-circle').length===3);
    await page.locator('[data-action="start"]').click();await page.locator('.turn-banner').waitFor();
    await page.screenshot({path:`test-results/site-edition/${edition}-${viewport.width}-game.png`});
    const identity=await page.evaluate(()=>JSON.parse(localStorage.getItem('catan:last')));
    await page.reload();await page.locator('.turn-banner').waitFor();assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('catan:last')))).token,identity.token);
    if(domestic){assert.equal(await page.locator('[data-action="openChat"],#chat-message').count(),0);assert.ok(!await page.locator('body').innerText().then(t=>t.includes('旧自由昵称')));}
    const controls=await page.locator('#stage-tools button:visible,#play-dock button:visible').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
    assert.ok(controls.every(r=>r.x>=-1&&r.y>=-1&&r.x+r.w<=viewport.width+1&&r.y+r.h<=viewport.height+1));
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log(`${edition}: desktop and mobile landscape nickname, room, bots, start and reload checks passed.`);
}finally{await browser.close();await app.close();await rm(dataDir,{recursive:true,force:true});}
