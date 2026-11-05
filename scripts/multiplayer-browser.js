import { chromium } from 'playwright';
import { Vector3 } from 'three';
import assert from 'node:assert/strict';
import { boardCamera, toggleBoard, openStagePanel } from './browser-stage-helpers.js';
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
  const [a,b,c]=clients;await a.page.goto(url);await a.page.locator('#nickname').fill('房主');await a.page.getByRole('button',{name:'创建好友房间'}).click();await a.wait(s=>s.phase==='lobby');const room=new URL(a.page.url()).searchParams.get('room');
  for(const [i,client] of [b,c].entries()){await client.page.goto(`${url}/?room=${room}`);await client.page.locator('#nickname').fill(`朋友${i+1}`);await client.page.getByRole('button',{name:'加入房间',exact:true}).click();await client.wait(s=>s.players.length>=2);await client.page.getByRole('button',{name:'我准备好了'}).click();await client.wait(s=>s.players.find(p=>p.id===s.me).ready);}
  await a.wait(s=>s.players.length===3&&s.players.slice(1).every(p=>p.ready));await a.page.getByRole('button',{name:'开始探索'}).click();await a.wait(s=>s.phase==='setup-settlement');
  // Project a legal intersection into the real 3D canvas, then click through the raycaster.
  const bounds=await a.page.locator('#board canvas').boundingBox(),v=a.state.board.vertices[a.state.legal.settlement[0]];
  const camera=await boardCamera(a.page,bounds,100);
  const point=new Vector3(v.x,.39,v.z).project(camera);await a.page.mouse.click(bounds.x+(point.x+1)*bounds.width/2,bounds.y+(1-point.y)*bounds.height/2);await a.wait(s=>s.phase==='setup-road');
  for(const client of clients)await toggleBoard(client.page,'切换二维棋盘');
  for(let i=0;i<11;i++){
    const current=clients.find(cl=>cl.state.me===a.state.players[a.state.turn].id),phase=a.state.phase,setup=a.state.setupIndex;
    await current.wait(s=>s.phase===phase&&s.setupIndex===setup);await current.page.locator('#board [data-id]').first().click();await a.wait(s=>s.phase!==phase||s.setupIndex!==setup);
  }
  await a.wait(s=>s.phase==='roll');await openStagePanel(a.page,'openChat');await openStagePanel(b.page,'openChat');await a.page.locator('#chat-message').fill('今晚一起开拓！');await a.page.getByRole('button',{name:'发送消息'}).click();await b.page.getByText('今晚一起开拓！',{exact:false}).waitFor();
  const id=a.state.me,revisionBoard=a.state.board;await a.page.close();const restored=await open(contexts[0]);await restored.page.goto(`${url}/?room=${room}`);await restored.wait(s=>s.phase==='roll');assert.equal(restored.state.me,id);assert.deepEqual(restored.state.board,revisionBoard);assert.equal(restored.state.players.length,3);
  for(const cl of [b,c])assert.ok(cl.state.players.filter(p=>p.id!==cl.state.me).every(p=>p.hand===undefined&&p.dev===undefined));
  assert.deepEqual(errors,[]);console.log('Multiplayer browser passed: 3 isolated browsers, lobby readiness, 3D raycast placement, full setup, chat, refresh identity and hand privacy.');
}finally{await browser.close();}
