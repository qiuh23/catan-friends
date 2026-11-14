import test from 'node:test';
import assert from 'node:assert/strict';
import {CatanRoom} from '../worker/index.js';
import {act} from '../shared/game.js';

globalThis.WebSocketRequestResponsePair ||= class {};
async function fixture() {
  const saved=new Map(),sockets=[],fault={alarm:false,directory:false};
  const storage={
    async get(key){return structuredClone(saved.get(key));},async put(key,value){saved.set(key,structuredClone(value));},
    async setAlarm(time){if(fault.alarm)throw Error('injected alarm write failure');saved.set('alarm',time);},async deleteAlarm(){saved.delete('alarm');},
    async transaction(callback){const before=structuredClone(saved);try{return await callback(storage);}catch(error){saved.clear();for(const [k,v]of before)saved.set(k,v);throw error;}},
  };
  const ctx={storage,getWebSockets:()=>sockets,setWebSocketAutoResponse(){},blockConcurrencyWhile(callback){this.ready=callback();}};
  const env={ROOMS:{idFromName:id=>id,get:()=>({async fetch(){if(fault.directory)throw Error('injected directory outage');return Response.json({ok:true});}})}};
  const object=new CatanRoom(ctx,env);await ctx.ready;
  const token=crypto.randomUUID(),created=await object.fetch(new Request('https://test/create?code=ABC234',{method:'POST',body:JSON.stringify({token,name:'房主'})}));assert.equal(created.status,201);
  let attachment={id:null,n:0,window:Date.now(),createdAt:Date.now()};
  const socket={readyState:1,messages:[],deserializeAttachment:()=>structuredClone(attachment),serializeAttachment(value){attachment=structuredClone(value);},send(raw){this.messages.push(JSON.parse(raw));},close(){this.readyState=3;}};sockets.push(socket);
  await object.webSocketMessage(socket,JSON.stringify({type:'hello',token,name:'房主'}));assert.ok(socket.deserializeAttachment().id);
  async function command(action,{id=crypto.randomUUID(),revision=object.room.record.revision}={}){await object.webSocketMessage(socket,JSON.stringify({type:'action',id,revision,action}));return socket.messages.findLast(m=>m.id===id);}
  return {object,saved,socket,command,fault};
}

test('Worker failed alarm write rolls back a human command and receipt, allowing exact retry once',async()=>{
  const f=await fixture(),before=structuredClone(f.object.room.record),revision=before.revision,id=crypto.randomUUID();
  f.fault.alarm=true;assert.equal((await f.command({type:'addBot'},{id,revision})).type,'error');
  assert.deepEqual(f.object.room.record,before);assert.deepEqual(f.saved.get('room'),before);assert.equal(f.object.room.record.receipts.some(r=>r.id===id),false);
  f.fault.alarm=false;assert.equal((await f.command({type:'addBot'},{id,revision})).type,'ack');assert.equal(f.object.room.record.game.players.length,2);
  assert.equal((await f.command({type:'addBot'},{id,revision})).type,'ack');assert.equal(f.object.room.record.game.players.length,2);
});

test('Worker start transaction rolls back all opening dice and retries the identical winner exactly once',async()=>{
  const f=await fixture();await f.command({type:'addBot'});await f.command({type:'addBot'});
  const before=structuredClone(f.object.room.record),revision=before.revision,id=crypto.randomUUID();
  const expected=act({...before.game,random:before.random},before.hostId,{type:'start'});
  f.fault.alarm=true;assert.equal((await f.command({type:'start'},{id,revision})).type,'error');
  assert.deepEqual(f.object.room.record,before);assert.deepEqual(f.saved.get('room'),before);
  f.fault.alarm=false;assert.equal((await f.command({type:'start'},{id,revision})).type,'ack');
  const committed=structuredClone(f.object.room.record);
  assert.deepEqual(committed.random,expected.random);assert.deepEqual(committed.game.startingPlayer,expected.startingPlayer);assert.deepEqual(committed.game.log,expected.log);
  assert.equal((await f.command({type:'start'},{id,revision})).type,'ack');
  assert.deepEqual(f.object.room.record.game,committed.game);assert.deepEqual(f.object.room.record.random,committed.random);
  assert.deepEqual(f.object.room.record.receipts,committed.receipts);assert.equal(f.object.room.record.revision,committed.revision);
});

test('Worker failed bot alarm persistence restores the pre-turn state and retry applies exactly one bot action',async()=>{
  const f=await fixture();await f.command({type:'addBot'});await f.command({type:'addBot'});await f.command({type:'start'});
  f.object.room.record.game.turn=1;await f.object.persist();const before=structuredClone(f.object.room.record);
  assert.equal(before.game.phase,'setup-settlement');f.fault.alarm=true;await assert.rejects(f.object.alarm(),/ROOM_ALARM_COMMIT_FAILED/);
  assert.deepEqual(f.object.room.record,before);assert.deepEqual(f.saved.get('room'),before);
  f.fault.alarm=false;await f.object.alarm();assert.equal(f.object.room.record.revision,before.revision+1);assert.equal(f.object.room.record.game.phase,'setup-road');
  assert.deepEqual(f.saved.get('room'),f.object.room.record);
});

test('Worker directory outage keeps an authoritative committed command and a future retry alarm',async()=>{
  const f=await fixture(),revision=f.object.room.record.revision,id=crypto.randomUUID();f.fault.directory=true;
  const originalError=console.error;console.error=()=>{};
  try{
    assert.equal((await f.command({type:'addBot'},{id,revision})).type,'ack');assert.equal(f.object.room.record.game.players.length,2);assert.deepEqual(f.saved.get('room'),f.object.room.record);
    assert.ok(f.saved.get('alarm')>Date.now());assert.equal((await f.command({type:'addBot'},{id,revision})).type,'ack');assert.equal(f.object.room.record.game.players.length,2);
  }finally{console.error=originalError;}
});
