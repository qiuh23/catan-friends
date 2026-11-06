import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../server/index.js';
import { openStagePanel,closeStagePanel,toggleBoard, openEntry } from './browser-stage-helpers.js';
const dataDir=await mkdtemp(path.join(os.tmpdir(),'catan-chat-ui-'));
const app=await createServer({port:0,host:'127.0.0.1',dataDir,security:{}}),url=`http://127.0.0.1:${app.port}`;
const browser=await chromium.launch({headless:true}),errors=[];await mkdir('test-results',{recursive:true});
async function client(){
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),result={page,state:null};
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const Native=window.WebSocket;
    window.WebSocket=class extends Native {
      send(raw){
        let message;try{message=JSON.parse(raw);}catch{}
        if(message?.action?.type==='chat'){
          if(window.__failNextChat){window.__failNextChat=false;throw Error('injected local send failure');}
          if(window.__delayNextChat){window.__delayNextChat=false;setTimeout(()=>super.send(raw),500);return;}
        }
        return super.send(raw);
      }
    };
  });
  page.on('websocket',socket=>socket.on('framereceived',frame=>{try{const message=JSON.parse(frame.payload);if(message.type==='state')result.state=message.state;}catch{}}));
  result.wait=async predicate=>{for(let i=0;i<400;i++){if(result.state&&predicate(result.state))return;await new Promise(resolve=>setTimeout(resolve,15));}throw Error('Browser state timeout');};return result;
}
try{
  const a=await client(),b=await client(),c=await client();await a.page.goto(url);await a.page.getByRole('button',{name:'隐私 / 举报',exact:true}).click();
  await a.page.getByText('qiutian0808@163.com · 用邮件举报',{exact:true}).waitFor();assert.match(await a.page.locator('#report-copy').innerText(),/90 天/);assert.match(await a.page.locator('#report-copy').innerText(),/尚未启用/);
  const mail=await a.page.locator('#report-mail').getAttribute('href');assert.ok(mail.startsWith('mailto:qiutian0808@163.com?'));assert.ok(!mail.includes('token'));await a.page.getByRole('button',{name:'关闭举报说明'}).click();
  await openEntry(a.page);await a.page.locator('#nickname').fill('房主');await a.page.getByRole('button',{name:'创建好友房间'}).click();await a.wait(s=>s.phase==='lobby');const room=new URL(a.page.url()).searchParams.get('room');
  for(const [i,player] of [b,c].entries()){await player.page.goto(`${url}/?room=${room}`);await openEntry(player.page);await player.page.locator('#nickname').fill('朋友'+(i+1));await player.page.getByRole('button',{name:'加入房间',exact:true}).click();await player.wait(s=>s.players.length>=2);await player.page.locator('[data-action=ready]').click();await player.wait(s=>s.players.find(p=>p.id===s.me).ready);}
  await a.wait(s=>s.players.length===3&&s.players.slice(1).every(p=>p.ready));await a.page.getByRole('button',{name:'开始探索'}).click();await a.wait(s=>s.phase==='setup-settlement');
  await toggleBoard(a.page,'切换二维棋盘');for(const player of [b,c])await openStagePanel(player.page,'openChat');
  await b.page.locator('#chat-message').fill('乙与落子同时发送');await c.page.locator('#chat-message').fill('丙与落子同时发送');
  await Promise.all([a.page.locator('#board [data-id]').first().click(),b.page.getByRole('button',{name:'发送消息'}).click(),c.page.getByRole('button',{name:'发送消息'}).click()]);
  await a.wait(s=>s.phase==='setup-road'&&s.chat.length===2);await b.wait(s=>s.chat.length===2);assert.equal(app.rooms.get(room).record.chat.length,2);
  await openStagePanel(a.page,'openChat');await a.page.locator('#chat-message').fill('失败时保留输入');await a.page.evaluate(()=>window.__failNextChat=true);await a.page.getByRole('button',{name:'发送消息'}).click();
  await a.page.getByText('消息发送失败，请稍后重试。',{exact:true}).waitFor();assert.equal(await a.page.locator('#chat-message').inputValue(),'失败时保留输入');
  await a.page.locator('#chat-message').fill('等待确认的消息');await a.page.evaluate(()=>window.__delayNextChat=true);await a.page.getByRole('button',{name:'发送消息'}).click();assert.equal(await a.page.locator('#chat-message').inputValue(),'等待确认的消息');await a.page.locator('#chat-message').fill('确认期间新写的草稿');
  await a.wait(s=>s.chat.some(message=>message.text==='等待确认的消息'));await a.page.waitForFunction(()=>!document.querySelector('#chat-form button').disabled);assert.equal(await a.page.locator('#chat-message').inputValue(),'确认期间新写的草稿');
  await a.page.locator('#chat-message').fill('成功后清空');await a.page.getByRole('button',{name:'发送消息'}).click();await a.page.waitForFunction(()=>document.querySelector('#chat-message').value==='');
  const message=app.rooms.get(room).record.chat.find(message=>message.text==='成功后清空');await a.page.locator(`[data-report-message="${message.id}"]`).click();await a.page.getByText('qiutian0808@163.com · 用邮件举报',{exact:true}).waitFor();assert.match(await a.page.locator('#report-copy').innerText(),new RegExp(message.name));
  await a.page.screenshot({path:'test-results/report-desktop.png'});await a.page.getByRole('button',{name:'关闭举报说明'}).click();
  for(const viewport of [{width:390,height:844},{width:844,height:390}]){
    await a.page.setViewportSize(viewport);await a.page.locator(`[data-report-message="${message.id}"]`).click();await a.page.getByText('qiutian0808@163.com · 用邮件举报',{exact:true}).waitFor();
    const rect=await a.page.locator('#report-dialog').boundingBox();assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewport.width+1&&rect.y+rect.height<=viewport.height+1);assert.ok(await a.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await a.page.screenshot({path:`test-results/report-${viewport.width}.png`});await a.page.getByRole('button',{name:'关闭举报说明'}).click();
  }
  const history=app.rooms.get(room).record.chat.map(message=>message.id);await a.page.reload();await a.wait(s=>s.chat.length===history.length);await a.page.locator('[data-action="openChat"]').waitFor();await openStagePanel(a.page,'openChat');await a.page.locator('#chat-messages [data-message-id]').first().waitFor();
  assert.deepEqual(await a.page.locator('#chat-messages [data-message-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.messageId)),history);
  await closeStagePanel(a.page);await openStagePanel(a.page,'openSettings');await a.page.getByRole('button',{name:'隐私 / 举报',exact:true}).click();await a.page.getByRole('button',{name:'关闭举报说明'}).click();
  assert.deepEqual(errors,[]);console.log('Chat/report browser passed: three players, simultaneous placement and chat, send failure preservation, edits during acknowledgement, exact history on refresh, menu/message reporting, confirmed mail/90-day policy, desktop/portrait/landscape fit.');
}finally{await browser.close();await app.close();await rm(dataDir,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
