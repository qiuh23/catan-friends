import test from 'node:test';
import assert from 'node:assert/strict';
import { CatanRoom } from '../worker/index.js';
import { HOST_RETENTION, PAUSE_RETENTION, PRACTICE_RETENTION } from '../shared/room.js';

// Run the actual Durable Object handlers with persisted storage, socket attachments
// and a deterministic clock. Real workerd smoke tests complement these boundaries.
globalThis.WebSocketRequestResponsePair ||= class {};
async function fixture(saved=new Map(),sockets=[],directoryEntries=new Map()) {
  const storage={
    async get(k){return structuredClone(saved.get(k));},
    async put(k,v){saved.set(k,structuredClone(v));},
    async list({prefix=''}){return new Map([...saved].filter(([k])=>k.startsWith(prefix)));},
    async setAlarm(v){saved.set('alarm',v);},async deleteAlarm(){saved.delete('alarm');},
    async transaction(fn){const before=structuredClone(saved);try{return await fn(storage);}catch(e){saved.clear();for(const [k,v]of before)saved.set(k,v);throw e;}}
  };
  const ctx={storage,getWebSockets:()=>sockets,setWebSocketAutoResponse(){},blockConcurrencyWhile(fn){this.ready=fn();}};
  const env={ROOMS:{idFromName:x=>x,get(){return {async fetch(req){const d=await req.json();directoryEntries.set(d.code,d);return Response.json({ok:true});}};}}};
  const object=new CatanRoom(ctx,env);await ctx.ready;
  function socket(){
    let attachment={id:null,n:0,window:Date.now(),createdAt:Date.now()};
    const ws={readyState:1,messages:[],deserializeAttachment:()=>structuredClone(attachment),serializeAttachment(v){attachment=structuredClone(v);},send(raw){this.messages.push(JSON.parse(raw));},close(){this.readyState=3;}};sockets.push(ws);return ws;
  }
  async function hello(token=crypto.randomUUID(),name='朋友'){const ws=socket();await object.webSocketMessage(ws,JSON.stringify({type:'hello',token,name}));return ws;}
  async function command(ws,action,extra={}){const id=crypto.randomUUID();await object.webSocketMessage(ws,JSON.stringify({type:'action',id,revision:object.room.record.revision,action,...extra}));return ws.messages.findLast(m=>m.id===id);}
  return {object,saved,sockets,directoryEntries,hello,command,async create(input={}){const token=crypto.randomUUID();const response=await object.fetch(new Request('https://test/create?code=ABC234',{method:'POST',body:JSON.stringify({token,name:'房主',...input})}));assert.equal(response.status,201,await response.text());return {token,host:await hello(token,'房主')};}};
}
async function clocked(fn){const original=Date.now;let time=1_000_000;Date.now=()=>time;try{await fn({advance:n=>{time+=n;},now:()=>time});}finally{Date.now=original;}}

test('Worker authority: public metadata, permissions, lobby leave/kick revocation, transfer and irreversible close',()=>clocked(async clock=>{
  const f=await fixture(),{host,token}=await f.create();const bToken=crypto.randomUUID(),b=await f.hello(bToken,'乙'),c=await f.hello();
  const summary=f.object.room.summary('ABC234');assert.equal(summary.playerCount,3);assert.ok(!JSON.stringify(summary).includes(token));assert.deepEqual(Object.keys(summary).sort(),['code','expiresAt','hostName','maxPlayers','minPlayers','options','phase','playerCount','revision','status','targetPoints'].sort());
  assert.equal((await f.command(b,{type:'close'})).type,'error');assert.equal((await f.command(b,{type:'kick',playerId:host.deserializeAttachment().id})).type,'error');
  assert.equal((await f.command(b,{type:'leave'})).type,'ack');assert.equal(f.object.room.record.game.players.length,2);const stale=await f.hello(bToken);assert.equal(stale.messages.at(-1).type,'error');
  const cId=c.deserializeAttachment().id;assert.equal((await f.command(host,{type:'kick',playerId:cId})).type,'ack');assert.equal(c.messages.at(-1).type,'removed');
  const next=await f.hello(),nextId=next.deserializeAttachment().id;assert.equal((await f.command(host,{type:'transferHost',playerId:nextId})).type,'ack');assert.equal(f.object.room.record.hostId,nextId);
  assert.equal((await f.command(host,{type:'close'})).type,'error');assert.equal((await f.command(next,{type:'configure',visibility:'private'})).type,'ack');assert.equal(f.object.room.summary('ABC234'),null);
  assert.equal((await f.command(next,{type:'close'})).type,'ack');assert.equal(host.messages.at(-1).type,'closed');assert.equal(f.saved.get('room').game,undefined);assert.equal(f.saved.get('room').identities,undefined);
  clock.advance(1);const recovered=await fixture(f.saved);const old=await recovered.hello(token);assert.equal(old.messages.at(-1).type,'error');assert.equal(recovered.object.room.record.closed,true);
}));

test('Worker host deadline survives other activity, alarms, hibernation and cold restart without renewal',()=>clocked(async clock=>{
  const f=await fixture(),{host,token}=await f.create(),other=await f.hello();host.close();await f.object.webSocketClose(host);const until=f.object.room.deadline();assert.equal(until,clock.now()+HOST_RETENTION);
  clock.advance(HOST_RETENTION-1);await f.command(other,{type:'chat',text:'在线成员不续期'});assert.equal(f.object.room.deadline(),until);
  const hibernated=await fixture(f.saved,f.sockets);assert.equal(hibernated.object.room.deadline(),until);
  clock.advance(1);await hibernated.object.alarm();assert.equal(hibernated.saved.get('room').closed,true);assert.equal(other.messages.at(-1).type,'closed');assert.equal((await hibernated.hello(token)).messages.at(-1).type,'error');
  const live=await fixture(),created=await live.create();clock.advance(HOST_RETENTION+1);const restarted=await fixture(live.saved,[]);assert.equal(restarted.object.room.record.closed,true);assert.equal((await restarted.hello(created.token)).messages.at(-1).type,'error');
}));

test('Worker paused first disconnect fixes four hours even across return/restart; practice ten minutes and private',()=>clocked(async clock=>{
  const f=await fixture(),{host,token}=await f.create();await f.command(host,{type:'addBot'});await f.command(host,{type:'addBot'});await f.command(host,{type:'start'});await f.command(host,{type:'pause'});host.close();await f.object.webSocketClose(host);const until=f.object.room.deadline();assert.equal(until,clock.now()+PAUSE_RETENTION);
  clock.advance(60_000);const rejoin=await f.hello(token);assert.equal(f.object.room.deadline(),until);clock.advance(60_000);rejoin.close();await f.object.webSocketClose(rejoin);assert.equal(f.object.room.deadline(),until);
  const restarted=await fixture(f.saved);assert.equal(restarted.object.room.deadline(),until);clock.advance(until-clock.now());await restarted.object.alarm();assert.equal(restarted.object.room.record.closed,true);
  const p=await fixture(),practice=await p.create({practice:true});assert.equal(p.object.room.summary('ABC234'),null);assert.equal((await p.hello()).messages.at(-1).type,'error');practice.host.close();await p.object.webSocketClose(practice.host);assert.equal(p.object.room.deadline(),clock.now()+PRACTICE_RETENTION);clock.advance(PRACTICE_RETENTION);await p.object.alarm();assert.equal(p.saved.get('room').closed,true);
}));

test('Worker final valid connection controls offline time, serialized stale actions fail, live host does not idle-expire',()=>clocked(async clock=>{
  const f=await fixture(),{host,token}=await f.create(),replacement=await f.hello(token);assert.equal(host.messages.at(-1).type,'replaced');assert.equal(f.object.room.deadline(),null);await f.object.webSocketClose(host);assert.equal(f.object.room.deadline(),null);
  clock.advance(49*60*60*1000);replacement.serializeAttachment({...replacement.deserializeAttachment(),lastSeen:Date.now()});await f.object.alarm();assert.equal(f.object.room.record.closed,undefined);assert.equal(f.object.room.deadline(),null);
  const revision=f.object.room.record.revision;const result=await Promise.all([f.command(replacement,{type:'addBot'},{revision}),f.command(replacement,{type:'addBot'},{revision})]);assert.equal(result.filter(x=>x.type==='ack').length,1);assert.equal(result.filter(x=>x.type==='error').length,1);
}));
