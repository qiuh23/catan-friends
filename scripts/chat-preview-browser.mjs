import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server/index.js';
import { openEntry } from './browser-stage-helpers.js';
const before=process.argv.includes('--before'),edition=process.env.SITE_EDITION||'global';
const out='docs/qa/chat-polish';await mkdir(out,{recursive:true});
const dataDir=await mkdtemp(path.join(os.tmpdir(),'catan-chat-preview-'));
const app=await createServer({port:0,dataDir,siteEdition:edition,development:true,botDelay:10000});
const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[];
const a=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),b=await browser.newPage();
await a.addInitScript(()=>{const Native=window.WebSocket;window.WebSocket=class extends Native {constructor(...args){super(...args);window.__chatReviewSocket=this;}};});
for(const page of [a,b])page.on('pageerror',e=>errors.push(e.message));
const base=`http://127.0.0.1:${app.port}`;
const shot=async name=>a.screenshot({path:`${out}/${before?'before':'after'}-${edition}-${name}.png`});
async function send(text){await b.locator('#chat-message').fill(text);await b.locator('#chat-form button').click();await b.getByText(text,{exact:true}).waitFor();}
try{
  await a.goto(base);if(edition==='cn')await a.locator('[data-action=openEntry]').click();else await openEntry(a);if(edition==='global')await a.locator('#nickname').fill('岛主');if(edition==='cn')assert.equal(await a.locator('#nickname').count(),0);await a.locator('#create-room').click();await a.locator('.waiting-banner').waitFor();
  const code=new URL(a.url()).searchParams.get('room');
  await b.goto(`${base}/?room=${code}`);if(edition==='cn')await b.locator('[data-action=openEntry]').click();else await openEntry(b);if(edition==='global')await b.locator('#nickname').fill('远航好友');await b.getByRole('button',{name:'加入房间',exact:true}).click();await b.locator('.waiting-banner').waitFor();
  if(!before&&edition==='global'){await b.locator('[data-action=openChat]').click();await send('候场一起打个招呼');await a.locator('.chat-preview button').waitFor();await shot('lobby-preview');await b.locator('[data-action=closeStagePanel]').click();}
  await b.locator('[data-action=ready]').click();await a.locator('[data-action="addBot"]').click();await a.getByRole('button',{name:'开始探索'}).click();await a.locator('.turn-banner').waitFor();
  if(edition==='global')await b.locator('[data-action="openChat"]').click();
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
    await a.setViewportSize(viewport);
    if(edition==='global'){await send(`一起开拓岛屿 ${viewport.width}`);if(!before)await a.locator('.chat-preview button').waitFor();}
    await a.waitForTimeout(250);await shot(`${viewport.width}-preview`);
    if(!before&&edition==='global'){
      assert.equal(await a.locator('.chat-preview button').count(),1);
      const fit=await a.locator('.chat-preview').evaluate(n=>{const r=n.getBoundingClientRect(),b=document.querySelector('[data-action=openChat]').getBoundingClientRect(),hits=[...document.querySelectorAll('.player-circle,#play-dock,.board-top')].some(e=>{const o=e.getBoundingClientRect();return r.left<o.right&&r.right>o.left&&r.top<o.bottom&&r.bottom>o.top;});return !hits&&r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&Math.hypot(Math.max(b.left-r.right,r.left-b.right,0),Math.max(b.top-r.bottom,r.top-b.bottom,0))<110;});assert.equal(fit,true);
    }
    assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1),true);
  }
  if(edition==='global'){
    await a.locator('[data-action="openChat"]').click();await a.locator('#chat-messages .chat-bubble').first().waitFor();await shot('history');
    const ids=await a.locator('#chat-messages [data-message-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.messageId));assert.equal(ids.length,before?3:4);
    if(!before)assert.equal(await a.locator('#chat-messages').innerText().then(t=>/#\d/.test(t)),false);
    if(!before){await a.locator('[data-action=closeStagePanel]').click();await a.clock.install();await send('自动消失仍保留历史');await a.locator('.chat-preview button').waitFor();await a.clock.fastForward(8500);await a.locator('.chat-preview').waitFor({state:'hidden'});}
    await a.reload();await a.locator('[data-action="openChat"]').click();await a.locator('#chat-messages .chat-bubble').first().waitFor();
    assert.deepEqual((await a.locator('#chat-messages [data-message-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.messageId))).slice(0,ids.length),ids);
    if(!before){
      await a.locator('[data-action=closeStagePanel]').click();
      await a.context().setOffline(true);await a.evaluate(()=>window.__chatReviewSocket.close());await a.locator('.connection.reconnecting').waitFor({state:'attached'});
      await new Promise(resolve=>setTimeout(resolve,2100));await send('重连期间历史不弹出');
      await a.context().setOffline(false);await a.locator('.connection.connected').waitFor({state:'attached'});
      assert.equal(await a.locator('.chat-preview').isVisible(),false);
      await a.locator('[data-action=openChat]').click();await a.getByText('重连期间历史不弹出',{exact:true}).waitFor();await a.locator('[data-action=closeStagePanel]').click();
      await new Promise(resolve=>setTimeout(resolve,2100));await send('重连后的新消息');await a.locator('.chat-preview button').waitFor();assert.match(await a.locator('.chat-preview').innerText(),/重连后的新消息/);
    }
  } else assert.equal(await a.locator('[data-action="openChat"],.chat-preview,#chat-message').count(),0);
  assert.deepEqual(errors,[]);console.log(`${edition}: chat preview, history and responsive captures passed (${before?'baseline':'updated'}).`);
}finally{await browser.close();await app.close();await rm(dataDir,{recursive:true,force:true});}
