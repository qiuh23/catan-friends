import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
class Client {
  constructor(port,code,token,name){this.messages=[];this.ws=new WebSocket(`ws://127.0.0.1:${port}/api/rooms/${code}/ws`);this.ws.on('open',()=>this.ws.send(JSON.stringify({type:'hello',token,name})));this.ws.on('message',raw=>{const m=JSON.parse(raw);this.messages.push(m);if(m.type==='state')this.state=m;});}
  async wait(predicate,after=0){for(let i=0;i<200;i++){const m=this.messages.slice(after).find(predicate);if(m)return m;await new Promise(r=>setTimeout(r,15));}throw new Error('Timed out waiting for message');}
  async action(action){const id=crypto.randomUUID(),start=this.messages.length;this.ws.send(JSON.stringify({type:'action',id,revision:this.state.revision,action}));const result=await this.wait(m=>m.id===id,start);if(result.type==='ack')await this.wait(m=>m.type==='state',start);return result;}
  close(){this.ws.close();}
}
test('real WebSockets: three players, private state, rejoin, idempotency, restart and room isolation',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'catan-network-'));let app=await createServer({port:0,dataDir,botDelay:20});const clients=[];
  try{
    const token=crypto.randomUUID();const response=await fetch(`http://127.0.0.1:${app.port}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'房主',token})});assert.equal(response.status,201);const {code}=await response.json();
    const a=new Client(app.port,code,token,'房主');clients.push(a);await a.wait(m=>m.type==='state');
    const b=new Client(app.port,code,crypto.randomUUID(),'朋友乙');clients.push(b);await b.wait(m=>m.type==='state');
    const c=new Client(app.port,code,crypto.randomUUID(),'朋友丙');clients.push(c);await c.wait(m=>m.type==='state');await a.wait(m=>m.type==='state'&&m.state.players.length===3);
    assert.equal((await b.action({type:'addBot'})).type,'error');
    await b.action({type:'ready'});await new Promise(r=>setTimeout(r,25));await c.action({type:'ready'});await new Promise(r=>setTimeout(r,25));assert.equal((await a.action({type:'start'})).type,'ack');
    const vertex=a.state.state.legal.settlement[0];assert.equal((await a.action({type:'buildSettlement',vertex})).type,'ack');
    await b.wait(m=>m.type==='state'&&m.state.phase==='setup-road');assert.ok(b.state.state.players.find(p=>p.id!==b.state.state.me).hand===undefined);assert.equal(b.state.state.deck,undefined);
    const actionId=crypto.randomUUID(),envelope={type:'action',id:actionId,revision:a.state.revision,action:{type:'buildRoad',edge:a.state.state.legal.road[0]}};const start=a.messages.length;a.ws.send(JSON.stringify(envelope));await a.wait(m=>m.type==='ack'&&m.id===actionId,start);await a.wait(m=>m.type==='state'&&m.state.turn===1,start);const revision=a.state.revision;
    a.ws.send(JSON.stringify(envelope));await new Promise(r=>setTimeout(r,40));assert.equal(a.state.revision,revision);assert.equal(a.state.state.board.edges.filter(e=>e.owner===a.state.state.me).length,1);
    const firstId=a.state.state.me;a.close();const reconnect=new Client(app.port,code,token,'改名不应占新座位');clients.push(reconnect);await reconnect.wait(m=>m.type==='state');assert.equal(reconnect.state.state.me,firstId);assert.equal(reconnect.state.state.players.length,3);
    const outsider=new Client(app.port,'ZZZZZZ',crypto.randomUUID(),'误入');clients.push(outsider);await outsider.wait(m=>m.type==='error'&&m.fatal);
    const intruder=new Client(app.port,code,crypto.randomUUID(),'新玩家');clients.push(intruder);await intruder.wait(m=>m.type==='error'&&m.fatal);
    const savedState=reconnect.state.state;for(const client of clients)client.close();await app.close();app=await createServer({port:0,dataDir});
    const restored=new Client(app.port,code,token,'房主');clients.push(restored);await restored.wait(m=>m.type==='state');assert.equal(restored.state.state.me,firstId);assert.deepEqual(restored.state.state.board,savedState.board);assert.equal(restored.state.state.turn,1);
  }finally{for(const c of clients)c.close();await app.close();await rm(dataDir,{recursive:true,force:true});}
});
