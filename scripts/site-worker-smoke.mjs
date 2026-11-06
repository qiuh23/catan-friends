import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { RuntimeClient } from '../tests/runtime-client.js';
import { NICKNAMES } from '../shared/site-policy.js';

const persistence=await mkdtemp(path.join(os.tmpdir(),'catan-cn-workerd-'));
const bundle=await build({entryPoints:['worker/index.js'],bundle:true,write:false,format:'esm',platform:'neutral'});
let mf,clients=[];
async function start(){mf=new Miniflare(convertV4MiniflareOptions({name:'cn-catan-test',script:bundle.outputFiles[0].text,modules:true,compatibilityDate:'2026-10-20',durableObjects:{ROOMS:{className:'CatanRoom',useSQLite:true}},resourcePersistencePath:persistence,bindings:{BACKEND_ID:'local',SITE_EDITION:'cn'}}));await mf.ready;}
async function stop(){for(const client of clients)client.close();clients=[];await mf.dispose();}
async function join(code,token){const response=await mf.dispatchFetch(`https://test/api/rooms/${code}/ws`,{headers:{Upgrade:'websocket'}});assert.equal(response.status,101);const socket=response.webSocket,client=new RuntimeClient(socket);clients.push(client);socket.accept();socket.send(JSON.stringify({type:'hello',token,nicknameId:'catan-01'}));await client.wait(m=>m.type==='state');return client;}
const token=crypto.randomUUID();
try{
  await start();
  assert.equal((await mf.dispatchFetch('https://test/api/rooms',{method:'POST',body:JSON.stringify({token,name:'free',siteEdition:'global'})})).status,400);
  const created=await mf.dispatchFetch('https://test/api/rooms',{method:'POST',body:JSON.stringify({token,nicknameId:'catan-01',siteEdition:'global'})});assert.equal(created.status,201);const {code}=await created.json();
  const a=await join(code,token),original=a.state.state.me;assert.equal(a.state.state.players[0].name,'白塔');
  for(const action of [{type:'chat',text:'secret'},{type:'phrase',phraseId:'hello'},{type:'emoji',emojiId:'smile'}]){
    const {result,envelope}=await a.request(action);assert.equal(result.message,'当前站点不提供玩家交流功能。');assert.equal((await a.request(action,envelope)).result.message,result.message);
  }
  await a.act({type:'addBot'});await a.act({type:'addBot'});assert.equal(new Set(a.state.state.players.map(p=>p.name)).size,3);
  assert.ok(a.state.state.players.every(p=>NICKNAMES.some(n=>n.name===p.name)));await a.act({type:'start'});await a.act({type:'pause'});assert.ok(a.state.state.room.paused);
  const state=a.state.state;assert.deepEqual(state.chat,[]);assert.equal((await mf.dispatchFetch('https://test/api/security/contact')).status,404);
  assert.equal((await mf.dispatchFetch(`https://test/api/stationmaster/rooms/${code}`,{method:'POST',body:'{}'})).status,404);
  await stop();await start();const b=await join(code,token);assert.equal(b.state.state.me,original);assert.equal(b.state.state.players[0].name,'白塔');assert.deepEqual(b.state.state.board,state.board);assert.ok(b.state.state.room.paused);assert.deepEqual(b.state.state.chat,[]);await b.act({type:'resume'});
  console.log('Local domestic workerd passed: fixed names, forged creation, communication retry rejection, bots/start/pause/restart/resume, no reporting or audit endpoints.');
}finally{if(mf)await stop();await rm(persistence,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
