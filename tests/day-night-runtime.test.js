import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WebSocket} from 'ws';
import {createServer} from '../server/index.js';
import {RuntimeClient} from './runtime-client.js';
import {dayNightAt} from '../src/visuals/day-night.js';

test('real WebSocket clients receive shared active scene time through start, pause, resume and reconnect',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'catan-scene-runtime-'));let now=1_000_000;
  const app=await createServer({port:0,host:'127.0.0.1',dataDir:dir,now:()=>now}),url=`http://127.0.0.1:${app.port}`,clients=[];
  const tokens=Array.from({length:3},()=>crypto.randomUUID());
  const join=async(code,token)=>{const c=new RuntimeClient(new WebSocket(`${url}/api/rooms/${code}/ws`));clients.push(c);c.ws.on('open',()=>c.ws.send(JSON.stringify({type:'hello',token,name:'日夜测试'})));await c.wait(m=>m.type==='state');return c;};
  const sync=async(c)=>{const from=c.messages.length;c.ws.send(JSON.stringify({type:'sync'}));return (await c.wait(m=>m.type==='state',from)).state;};
  try{
    const {code}=await(await fetch(url+'/api/rooms',{method:'POST',body:JSON.stringify({token:tokens[0],name:'房主'})})).json();
    const a=await join(code,tokens[0]),b=await join(code,tokens[1]),c=await join(code,tokens[2]);
    for(const peer of [b,c]){await sync(peer);await peer.act({type:'ready'});}
    await sync(a);await a.act({type:'start'});
    for(const elapsed of [60000,270000,360000]){now=1_000_000+elapsed;const views=await Promise.all([a,b,c].map(sync));assert.ok(views.every(v=>v.room.sceneClock.elapsedMs===elapsed&&v.room.sceneClock.running));assert.deepEqual(views.map(v=>dayNightAt(v.room.sceneClock.elapsedMs)),Array(3).fill(dayNightAt(elapsed)));}
    await a.act({type:'pause'});now+=60000;assert.equal((await sync(b)).room.sceneClock.elapsedMs,360000);
    b.ws.terminate();const restored=await join(code,tokens[1]);assert.equal(restored.state.state.room.sceneClock.elapsedMs,360000);assert.equal(restored.state.state.room.sceneClock.running,false);
    await sync(a);await a.act({type:'resume'});now+=30000;assert.equal((await sync(restored)).room.sceneClock.elapsedMs,390000);
    for(const peer of clients)assert.ok(peer.messages.filter(m=>m.type==='state').every(m=>m.state.players.filter(p=>p.id!==m.state.me).every(p=>p.hand===undefined&&p.dev===undefined)));
  }finally{for(const c of clients)c.ws.terminate();await app.close();await rm(dir,{recursive:true,force:true});}
});
