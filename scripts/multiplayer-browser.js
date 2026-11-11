import { chromium } from 'playwright';
import { Vector3 } from 'three';
import assert from 'node:assert/strict';
import { boardCamera, toggleBoard, openStagePanel, closeStagePanel, openEntry } from './browser-stage-helpers.js';
const url=process.env.TEST_URL||'http://127.0.0.1:5175',browser=await chromium.launch({headless:true});
const errors=[];
async function open(context){
  const page=await context.newPage(),client={page,state:null};page.on('pageerror',e=>errors.push(e.message));
  page.on('websocket',socket=>socket.on('framereceived',frame=>{try{const m=JSON.parse(frame.payload);if(m.type==='state')client.state=m.state;}catch{}}));
  client.wait=async predicate=>{for(let i=0;i<300;i++){if(client.state&&predicate(client.state))return;await new Promise(r=>setTimeout(r,20));}throw new Error('Browser state timeout');};return client;
}
try{
  const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({viewport:{width:1440,height:960}}))),clients=[];
  for(const context of contexts)clients.push(await open(context));
  const [a,b,c]=clients;await a.page.goto(url);await openEntry(a.page);await a.page.locator('#nickname').fill('房主');await a.page.getByRole('button',{name:'创建好友房间'}).click();await a.wait(s=>s.phase==='lobby');const room=new URL(a.page.url()).searchParams.get('room');
  for(const [i,client] of [b,c].entries()){await client.page.goto(`${url}/?room=${room}`);await openEntry(client.page);await client.page.locator('#nickname').fill(`朋友${i+1}`);await client.page.getByRole('button',{name:'加入房间',exact:true}).click();await client.wait(s=>s.players.length>=2);await client.page.locator('[data-action=ready]').click();await client.wait(s=>s.players.find(p=>p.id===s.me).ready);}
  await a.wait(s=>s.players.length===3&&s.players.slice(1).every(p=>p.ready));await a.page.getByRole('button',{name:'开始探索'}).click();await a.wait(s=>s.phase==='setup-settlement');
  // Project a legal intersection into the real 3D canvas, then click through the raycaster.
  await a.page.locator('#board canvas[data-site-shape=settlement]').waitFor();
  const bounds=await a.page.locator('#board canvas').boundingBox();
  const camera=await boardCamera(a.page,bounds,100);
  let placed=false;
  // Random terrain or a port label can occlude the first legal vertex. Hover
  // actual projected inlays and click one the real hit tester marks visible.
  for(const id of a.state.legal.settlement){
    const v=a.state.board.vertices[id],point=new Vector3(v.x,.298,v.z).project(camera);
    const x=bounds.x+(point.x+1)*bounds.width/2,y=bounds.y+(1-point.y)*bounds.height/2;
    if(x<0||x>bounds.width||y<0||y>bounds.height)continue;
    await a.page.mouse.move(x,y);await a.page.waitForTimeout(20);
    if(await a.page.locator('#board canvas').getAttribute('data-selected-site')!==`vertex:${id}`)continue;
    await a.page.mouse.click(x,y);await a.wait(s=>s.phase==='setup-road');placed=true;break;
  }
  assert.ok(placed,'no visible legal 3D placement found');
  for(const client of clients)await toggleBoard(client.page,'切换二维棋盘');
  for(let i=0;i<11;i++){
    const current=clients.find(cl=>cl.state.me===a.state.players[a.state.turn].id),phase=a.state.phase,setup=a.state.setupIndex;
    await current.wait(s=>s.phase===phase&&s.setupIndex===setup);await current.page.locator('#board [data-id]').first().click();await a.wait(s=>s.phase!==phase||s.setupIndex!==setup);
  }
  await a.wait(s=>s.phase==='roll');
  // The retained controller still owns real room actions and confirmation.
  await a.page.locator('#stage-tools [data-action=pauseGame]').click();await a.page.locator('[data-action=confirmRoomDialog]').click();
  for(const client of clients)await client.wait(s=>s.room.paused);
  await openStagePanel(a.page,'openChat');await openStagePanel(b.page,'openChat');await a.page.locator('#chat-message').fill('今晚一起开拓！');await a.page.getByRole('button',{name:'发送消息'}).click();await b.page.getByText('今晚一起开拓！',{exact:false}).waitFor();
  await closeStagePanel(a.page);await a.page.locator('#stage-tools [data-action=resumeGame]').click();
  for(const client of clients)await client.wait(s=>!s.room.paused&&s.phase==='roll');
  for(const [from,to]of [[a,b],[b,a]]){
    await openStagePanel(from.page,'openSettings');await from.page.locator('[data-action=transferMenu]').click();
    await from.page.locator('#transfer-choice').selectOption(to.state.me);await from.page.locator('[data-action=confirmRoomDialog]').click();
    await to.wait(s=>s.room.hostId===s.me);await from.wait(s=>s.room.hostId===to.state.me);await closeStagePanel(from.page);
  }
  const id=a.state.me,revisionBoard=a.state.board;await a.page.close();const restored=await open(contexts[0]);await restored.page.goto(`${url}/?room=${room}`);await restored.wait(s=>s.phase==='roll');assert.equal(restored.state.me,id);assert.deepEqual(restored.state.board,revisionBoard);assert.equal(restored.state.players.length,3);
  for(const cl of [b,c])assert.ok(cl.state.players.filter(p=>p.id!==cl.state.me).every(p=>p.hand===undefined&&p.dev===undefined));
  assert.deepEqual(errors,[]);console.log('Multiplayer browser passed: 3 isolated browsers, lobby readiness, 3D raycast placement, full setup, pause/resume, live chat while paused, host transfer, refresh identity and hand privacy.');
}finally{await browser.close();}
