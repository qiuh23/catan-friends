import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createServer} from '../server/index.js';
import {openEntry} from './browser-stage-helpers.js';
const out='test-results/day-night';await mkdir(out,{recursive:true});
const dir=await mkdtemp(path.join(os.tmpdir(),'catan-day-night-'));let now=Date.now();
const app=await createServer({development:true,port:0,host:'127.0.0.1',dataDir:dir,now:()=>now});
const url=`http://127.0.0.1:${app.port}`,errors=[],results={};
let browser;
const launch=()=>chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader']});
async function client(viewport={width:1366,height:900},reducedMotion='no-preference'){
  const context=await browser.newContext({viewport,reducedMotion});
  await context.addInitScript(()=>{const Original=window.WebSocket;window.WebSocket=class extends Original{constructor(...args){super(...args);(window.__sockets||=[]).push(this);}};});
  await context.route('**/src/board3d.js*',async route=>{const response=await route.fetch(),source=await response.text();await route.fulfill({response,body:source.replace('export class Board {','class ActualBoard {')+'\nexport class Board extends ActualBoard { constructor(...args){super(...args);window.__visualBoard=this;} }'});});
  const page=await context.newPage(),c={context,page,state:null};
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('websocket',socket=>socket.on('framereceived',frame=>{try{const m=JSON.parse(frame.payload);if(m.type==='state')c.state=m.state;}catch{}}));
  c.wait=async test=>{for(let i=0;i<300;i++){if(c.state&&test(c.state))return;await new Promise(r=>setTimeout(r,40));}throw Error('State timeout');};
  c.sync=()=>page.evaluate(()=>{for(const socket of window.__sockets||[])if(socket.url.includes('/api/rooms/')&&socket.readyState===1)socket.send(JSON.stringify({type:'sync'}));});
  c.stats=()=>page.evaluate(()=>{const b=window.__visualBoard,s=b.environment.sky;return {cycle:b.environment.getState().cycle,sun:s.uniforms.uOrbitSun.value.toArray(),moon:s.uniforms.uOrbitMoon.value.toArray(),night:s.uniforms.uNight.value,renderStats:JSON.parse(b.renderer.domElement.dataset.renderStats),windows:b.models.nightUniform.value,sceneTimer:!!b.sceneTimer};});
  return c;
}
try{
  browser=await launch();
  const a=await client(),b=await client({width:390,height:844}),c=await client({width:844,height:390},'reduce');
  await a.page.goto(url);await a.page.waitForFunction(()=>window.__visualBoard?.models.ready.size>5);await a.page.waitForTimeout(400);
  const homeBefore=await a.stats();await a.page.waitForTimeout(800);const homeAfter=await a.stats();assert.ok(homeAfter.cycle>homeBefore.cycle);assert.ok(homeAfter.sun[0]>homeBefore.sun[0]);
  const beforeDrag=await a.page.evaluate(()=>({time:window.__visualBoard.homeTime,cycle:window.__visualBoard.environment.getState().cycle}));
  await a.page.mouse.move(650,500);await a.page.mouse.down();await a.page.mouse.move(760,520,{steps:8});await a.page.mouse.up();await a.page.waitForTimeout(800);
  const afterDrag=await a.page.evaluate(()=>({time:window.__visualBoard.homeTime,cycle:window.__visualBoard.environment.getState().cycle,interrupted:window.__visualBoard.ambientInterrupted}));
  assert.ok(afterDrag.interrupted&&afterDrag.time>beforeDrag.time&&afterDrag.cycle>beforeDrag.cycle,'drag stopped or reset scene animation');
  await a.page.screenshot({path:`${out}/home-day.png`});results.home={before:homeBefore,after:homeAfter};
  await openEntry(a.page);await a.page.locator('#nickname').fill('日夜房主');await a.page.getByRole('button',{name:'创建好友房间'}).click();await a.wait(s=>s.phase==='lobby');const room=new URL(a.page.url()).searchParams.get('room');
  for(const [i,peer] of [b,c].entries()){await peer.page.goto(`${url}/?room=${room}`);await openEntry(peer.page);await peer.page.locator('#nickname').fill(`日夜玩家${i+1}`);await peer.page.getByRole('button',{name:'加入房间',exact:true}).click();await peer.wait(s=>s.players.length>=2);await peer.page.locator('[data-action=ready]').click();await peer.wait(s=>s.players.find(p=>p.id===s.me).ready);}
  await a.wait(s=>s.players.length===3&&s.players.slice(1).every(p=>p.ready));await a.page.getByRole('button',{name:'开始探索'}).click();await a.wait(s=>s.phase==='setup-settlement');
  for(const peer of [a,b,c])await peer.page.waitForFunction(()=>window.__visualBoard?.renderer.domElement.dataset.models&&JSON.parse(window.__visualBoard.renderer.domElement.dataset.models).tiles===19);
  // Actual game actions, not environment setters: build both opening settlements
  // for every player through the production WebSocket/Room authority.
  for(let step=0;step<12;step++){
    const state=a.state,peer=[a,b,c].find(p=>p.state.me===state.players[state.turn].id),oldIndex=state.setupIndex,oldPhase=state.phase;
    await peer.wait(s=>s.phase===oldPhase&&s.setupIndex===oldIndex);
    // Production flat board controls exercise the controller's current revision.
    const toggle=peer.page.locator('#flat-toggle');if(await toggle.getAttribute('aria-label')==='切换二维棋盘')await toggle.click();
    await peer.page.locator('#board [data-id]').first().click();await a.wait(s=>s.phase!==oldPhase||s.setupIndex!==oldIndex);
  }
  for(const peer of [a,b,c]){if(await peer.page.locator('#flat-toggle').getAttribute('aria-label')==='切换三维棋盘')await peer.page.locator('#flat-toggle').click();await peer.page.waitForFunction(()=>window.__visualBoard?.models.ready.size>5);}
  for(const [label,elapsed] of [['day',60000],['dusk',270000],['night',360000]]){
    now+=elapsed-(results.elapsed||0);results.elapsed=elapsed;
    for(const peer of [a,b,c])await peer.sync();
    await a.wait(s=>s.room.sceneClock.elapsedMs===elapsed);await b.wait(s=>s.room.sceneClock.elapsedMs===elapsed);await a.page.waitForTimeout(300);
    const as=await a.stats(),bs=await b.stats();assert.ok(Math.abs(as.cycle-bs.cycle)<.002,'room players diverged');assert.equal(a.state.room.sceneClock.elapsedMs,b.state.room.sceneClock.elapsedMs);
    for(const [name,peer] of [['desktop',a],['portrait',b],['landscape-reduced',c]])await peer.page.screenshot({path:`${out}/${name}-${label}.png`});
    results[label]={desktop:as,portrait:bs};
  }
  assert.ok(results.night.desktop.windows>.99);assert.equal((await c.stats()).sceneTimer,false);
  const moving=await a.stats();await a.page.mouse.move(680,500);await a.page.mouse.down();await a.page.mouse.move(790,530,{steps:12});await a.page.mouse.up();await a.page.waitForTimeout(900);assert.ok((await a.stats()).moon[0]>moving.moon[0],'game drag stopped moon orbit');
  await a.page.locator('#stage-tools [data-action=pauseGame]').click();await a.page.locator('[data-action=confirmRoomDialog]').click();await a.wait(s=>s.room.paused);await a.page.waitForTimeout(150);
  const paused=await a.stats();now+=60000;await a.sync();await a.page.waitForTimeout(400);assert.equal((await a.stats()).cycle,paused.cycle);assert.equal((await a.stats()).sceneTimer,false);
  await b.page.reload();await b.wait(s=>s.room.paused);await b.page.waitForFunction(()=>window.__visualBoard?.environment.getState().cycle>.5);assert.ok(Math.abs((await b.stats()).cycle-paused.cycle)<1e-9,'reload reset night');
  await a.page.locator('#stage-tools [data-action=resumeGame]').click();await a.wait(s=>!s.room.paused);now+=30000;await a.sync();await a.wait(s=>s.room.sceneClock.elapsedMs===390000);assert.ok((await a.stats()).cycle>paused.cycle);
  results.pause={cycle:paused.cycle,reconnected:(await b.stats()).cycle};
  assert.deepEqual(errors,[]);await writeFile(`${out}/results.json`,JSON.stringify({...results,errors},null,2));console.log('PASS real three-player start/setup, day/dusk/night, smooth live movement, shared clock, pause/reload/resume, desktop/portrait/landscape and reduced motion');
}finally{await browser?.close();await app.close();await rm(dir,{recursive:true,force:true});}
