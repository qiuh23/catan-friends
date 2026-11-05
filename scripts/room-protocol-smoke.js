// Run only against a loopback server. No public rooms or production data are touched.
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
let app,dataDir,origin=process.env.TEST_URL;
if(!origin){dataDir=await mkdtemp(path.join(os.tmpdir(),'catan-protocol-'));app=await createServer({host:'127.0.0.1',port:0,dataDir});origin=`http://127.0.0.1:${app.port}`;}
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname),'Local verification only');
const sockets=[],delay=ms=>new Promise(r=>setTimeout(r,ms));
async function join(code,token=crypto.randomUUID(),name='朋友'){
  const ws=new WebSocket(origin.replace('http','ws')+`/api/rooms/${code}/ws`),c={ws,token,messages:[],state:null};sockets.push(ws);
  ws.on('open',()=>ws.send(JSON.stringify({type:'hello',token,name})));ws.on('message',raw=>{const m=JSON.parse(raw);c.messages.push(m);if(m.type==='state')c.state=m;});
  ws.on('error',error=>c.messages.push({type:'error',message:error.message}));
  c.wait=async(predicate,after=0)=>{for(let n=0;n<500;n++){const m=c.messages.slice(after).find(predicate);if(m)return m;await delay(10);}throw Error(`Protocol timeout ${code}: ${JSON.stringify(c.messages.at(-1))}`);};
  c.action=async action=>{const id=crypto.randomUUID(),after=c.messages.length;ws.send(JSON.stringify({type:'action',id,revision:c.state.revision,action}));const result=await c.wait(m=>m.id===id,after);assert.equal(result.type,'ack',JSON.stringify(result));if(action.type!=='close')await c.wait(m=>m.type==='state',after);return c.state.revision;};
  c.close=async()=>{if(ws.readyState===3)return;await new Promise(resolve=>{ws.once('close',resolve);ws.close();});};
  await c.wait(m=>m.type==='state'||m.type==='error'||m.type==='closed');return c;
}
async function settled(clients,revision){await Promise.all(clients.filter(c=>c.ws.readyState===1).map(c=>c.wait(m=>m.type==='state'&&m.revision>=revision)));}
async function list(){const response=await fetch(origin+'/api/rooms');assert.equal(response.status,200,await response.clone().text());return (await response.json()).rooms;}
try{
  for(const count of [3,4,5,6]){
    const options={playerExpansion:count>=5?'five-six-2025':'base',friendlyRobber:true,harbormaster:true};
    const token=crypto.randomUUID(),response=await fetch(origin+'/api/rooms',{method:'POST',body:JSON.stringify({token,name:`${count}人房主`,visibility:'public',options})});assert.equal(response.status,201,await response.clone().text());const {code}=await response.json();
    const clients=[await join(code,token)];for(let n=1;n<count;n++)clients.push(await join(code));await settled(clients,clients.at(-1).state.revision);
    const entry=(await list()).find(v=>v.code===code);assert.equal(entry.playerCount,count);assert.equal(entry.maxPlayers,count>=5?6:4);assert.equal(entry.minPlayers,count>=5?5:3);assert.ok(!JSON.stringify(entry).match(/token|identities|hand|deck|receipts/));
    for(const c of clients.slice(1)){const rev=await c.action({type:'ready',ready:true});await settled(clients,rev);}
    let rev=await clients[0].action({type:'start'});await settled(clients,rev);
    const intruder=await join(code);assert.equal(intruder.messages.at(-1).type,'error');
    while(clients[0].state.state.phase.startsWith('setup')){
      const state=clients[0].state.state,active=clients[state.turn];rev=await active.action(state.phase==='setup-settlement'?{type:'buildSettlement',vertex:active.state.state.legal.settlement[0]}:{type:'buildRoad',edge:active.state.state.legal.road[0]});await settled(clients,rev);
    }
    assert.equal(clients[0].state.state.board.tiles.length,count>=5?30:19);assert.equal(clients[0].state.state.board.ports.length,count>=5?11:9);
    for(const c of clients){assert.equal(c.state.state.deck,undefined);assert.ok(c.state.state.players.filter(p=>p.id!==c.state.state.me).every(p=>p.hand===undefined&&p.dev===undefined));}
    if(count>=5){
      rev=await clients[0].action({type:'roll'});await settled(clients,rev);
      while(['robber','steal'].includes(clients[0].state.state.phase)){const s=clients[0].state.state;rev=await clients[0].action(s.phase==='robber'?{type:'moveRobber',tile:s.legal.robber[0]}:{type:'steal',victim:s.legal.victims[0]});await settled(clients,rev);}
      rev=await clients[0].action({type:'endTurn'});await settled(clients,rev);assert.equal(clients[0].state.state.pairStep,'secondary');
    }
    if(app){
      const before=clients.map(c=>structuredClone(c.state.state)),tokens=clients.map(c=>c.token);for(const c of clients)await c.close();await app.close();app=await createServer({host:'127.0.0.1',port:0,dataDir});origin=`http://127.0.0.1:${app.port}`;
      for(let i=0;i<count;i++){clients[i]=await join(code,tokens[i]);const restored=clients[i].state.state;assert.equal(restored.me,before[i].me);assert.equal(restored.turn,before[i].turn);assert.equal(restored.pairStep,before[i].pairStep);assert.deepEqual(restored.options,before[i].options);assert.deepEqual(restored.board,before[i].board);assert.deepEqual(restored.players.find(p=>p.id===restored.me).hand,before[i].players.find(p=>p.id===restored.me).hand);}
      await settled(clients,clients.at(-1).state.revision);
    }
    const index=count-1,previous=structuredClone(clients[index].state.state),oldToken=clients[index].token;await clients[index].close();const restored=await join(code,oldToken);clients[index]=restored;assert.equal(restored.state.state.me,previous.me);assert.deepEqual(restored.state.state.board,previous.board);assert.deepEqual(restored.state.state.players.find(p=>p.id===previous.me).hand,previous.players.find(p=>p.id===previous.me).hand);
    rev=await clients[0].action({type:'pause'});await settled(clients,rev);await clients[0].close();await clients[1].wait(m=>m.type==='state'&&m.state.room.expiresAt!==null);const deadline=clients[1].state.state.room.expiresAt;const host=await join(code,token);clients[0]=host;assert.equal(host.state.state.room.expiresAt,deadline);rev=await host.action({type:'resume'});await settled(clients,rev);
    rev=await host.action({type:'configure',visibility:'private'}).catch(()=>null);
    // Active rule/visibility changes are rejected. Then host authority closes it.
    assert.equal(rev,null);await host.action({type:'close'});await clients[1].wait(m=>m.type==='closed');assert.equal((await list()).some(v=>v.code===code),false);const stale=await join(code,token);assert.ok(['error','closed'].includes(stale.messages.at(-1).type));
    console.log(`${count} players passed: capacity/profile, public list, ready, full setup, private views, reconnect${app?', server restart':''}, fixed pause and irreversible close.`);
    for(const c of clients)await c.close();
  }
  // Private and practice are absent from discovery, including an expanded practice.
  for(const extra of [{visibility:'private'},{practice:true,options:{playerExpansion:'five-six-2025'}}]){
    const token=crypto.randomUUID(),r=await fetch(origin+'/api/rooms',{method:'POST',body:JSON.stringify({token,name:'独立房间',...extra})});assert.equal(r.status,201,await r.clone().text());const {code}=await r.json(),host=await join(code,token);assert.equal((await list()).some(v=>v.code===code),false);if(extra.practice)assert.equal(host.state.state.players.length,5);await host.action({type:'close'});await host.close();
  }
}finally{for(const ws of sockets)ws.terminate();await app?.close();if(dataDir)await rm(dataDir,{recursive:true,force:true});}
