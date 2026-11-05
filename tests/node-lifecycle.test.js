import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';
import { Room, HOST_RETENTION, PAUSE_RETENTION, PRACTICE_RETENTION } from '../shared/room.js';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
class Client {
  constructor(origin,code,token=crypto.randomUUID()){this.messages=[];this.token=token;this.ws=new WebSocket(origin.replace('http','ws')+`/api/rooms/${code}/ws`);this.ws.on('open',()=>this.ws.send(JSON.stringify({type:'hello',token,name:'测试玩家'})));this.ws.on('message',raw=>{const m=JSON.parse(raw);this.messages.push(m);if(m.type==='state')this.state=m;});}
  async wait(predicate,after=0){for(let i=0;i<400;i++){const v=this.messages.slice(after).find(predicate);if(v)return v;await delay(10);}throw Error('Node lifecycle message timeout');}
  async action(action,revision=this.state.revision){const id=crypto.randomUUID(),after=this.messages.length;this.ws.send(JSON.stringify({type:'action',id,revision,action}));const reply=await this.wait(m=>m.id===id,after);if(reply.type==='ack' && !['leave','close'].includes(action.type))await this.wait(m=>m.type==='state',after);return reply;}
  async close(){if(this.ws.readyState===3)return;await new Promise(resolve=>{this.ws.once('close',resolve);this.ws.close();});await delay(10);}
}
async function scenario(fn){let time=1000000;const dataDir=await mkdtemp(path.join(os.tmpdir(),'catan-lifecycle-'));let app=await createServer({port:0,dataDir,now:()=>time}),clients=[];const endpoint=()=>`http://127.0.0.1:${app.port}`;
  const api={get app(){return app;},dataDir,endpoint,advance:n=>{time+=n;},now:()=>time,async create(extra={}){const token=crypto.randomUUID(),res=await fetch(endpoint()+'/api/rooms',{method:'POST',body:JSON.stringify({token,name:'房主',...extra})});assert.equal(res.status,201);const {code}=await res.json();return {token,code,host:await api.join(code,token)};},async join(code,token){const c=new Client(endpoint(),code,token);clients.push(c);await c.wait(m=>m.type==='state'||m.type==='error');return c;},async list(){const response=await fetch(endpoint()+'/api/rooms');assert.equal(response.status,200);return (await response.json()).rooms;},async restart(){for(const c of clients)await c.close();await app.close();app=await createServer({port:0,dataDir,now:()=>time});}};
  try{await fn(api);}finally{for(const c of clients)await c.close();await app.close();await rm(dataDir,{recursive:true,force:true});}
}

test('Node 30 minute deadline ignores peers, returns original identity and persists expired tombstone across restart',()=>scenario(async f=>{
  const {host,token,code}=await f.create(),other=await f.join(code),identity=host.state.state.me;await host.close();await f.app.sweep();let room=f.app.rooms.get(code),until=room.deadline();assert.equal(until,f.now()+HOST_RETENTION);
  f.advance(HOST_RETENTION-1);await other.action({type:'chat',text:'不能续期'});assert.equal(room.deadline(),until);
  const returning=await f.join(code,token);assert.equal(returning.state.state.me,identity);assert.equal(room.deadline(),null);await returning.close();await f.app.sweep();until=room.deadline();
  f.advance(HOST_RETENTION);await f.app.sweep();await other.wait(m=>m.type==='closed');assert.equal((await f.list()).some(x=>x.code===code),false);const saved=JSON.parse(await readFile(path.join(f.dataDir,code+'.json'),'utf8'));assert.equal(saved.closed,true);assert.equal(saved.game,undefined);
  await f.restart();const old=await f.join(code,token);assert.equal(old.messages.at(-1).type,'error');assert.equal(f.app.rooms.get(code).record.closed,true);
}));

test('Node four hour pause remains fixed through short rejoin, practice ten minute expiry, active host never idle-expires',()=>scenario(async f=>{
  const {host,token,code}=await f.create();await host.action({type:'addBot'});await host.action({type:'addBot'});await host.action({type:'start'});await host.action({type:'pause'});await host.close();await f.app.sweep();const until=f.app.rooms.get(code).deadline();assert.equal(until,f.now()+PAUSE_RETENTION);
  f.advance(60000);const rejoin=await f.join(code,token);assert.equal(f.app.rooms.get(code).deadline(),until);await rejoin.close();f.advance(until-f.now());await f.app.sweep();assert.equal(f.app.rooms.get(code).record.closed,true);
  const p=await f.create({practice:true});assert.equal((await f.list()).some(x=>x.code===p.code),false);assert.equal((await f.join(p.code)).messages.at(-1).type,'error');await p.host.close();await f.app.sweep();assert.equal(f.app.rooms.get(p.code).deadline(),f.now()+PRACTICE_RETENTION);f.advance(PRACTICE_RETENTION);await f.app.sweep();assert.equal(f.app.rooms.get(p.code).record.closed,true);
  const online=await f.create();f.advance(49*60*60*1000);await f.app.sweep();assert.equal(f.app.rooms.get(online.code).record.closed,undefined);assert.equal(f.app.rooms.get(online.code).deadline(),null);
}));

test('Node list excludes private/practice; leave frees seat, kick revokes identity, transfer changes permissions, close notifies everyone',()=>scenario(async f=>{
  const {host,code,token}=await f.create(),b=await f.join(code),c=await f.join(code);await host.wait(m=>m.type==='state'&&m.state.players.length===3);const bId=b.state.state.me;
  assert.equal((await f.list()).find(x=>x.code===code).playerCount,3);assert.equal((await b.action({type:'close'})).type,'error');
  assert.equal((await b.action({type:'leave'})).type,'ack');await host.wait(m=>m.type==='state'&&m.state.players.length===2);assert.equal((await f.join(code,b.token)).messages.at(-1).type,'error');
  assert.equal((await host.action({type:'kick',playerId:c.state.state.me})).type,'ack');await c.wait(m=>m.type==='removed');assert.equal((await f.join(code,c.token)).messages.at(-1).type,'error');
  const next=await f.join(code);await host.wait(m=>m.type==='state'&&m.state.players.length===2);await host.action({type:'transferHost',playerId:next.state.state.me});await next.wait(m=>m.type==='state'&&m.state.room.hostId===next.state.state.me);
  assert.equal((await host.action({type:'close'})).type,'error');await next.action({type:'configure',visibility:'private'});assert.equal((await f.list()).some(x=>x.code===code),false);
  await next.action({type:'close'});await host.wait(m=>m.type==='closed');assert.equal((await f.join(code,token)).messages.at(-1).type,'error');assert.ok(!f.app.rooms.get(code).record.identities);assert.ok(!f.app.rooms.get(code).record.game);
}));

test('Node public directory pages without duplicating or silently hiding rooms and rejects invalid cursors',()=>scenario(async f=>{
  const alphabet='23456789';
  for(let i=0;i<42;i++){const code=`ABCD${alphabet[Math.floor(i/8)]}${alphabet[i%8]}`,room=new Room(undefined,f.now());room.join('test-hash-'+i,'公开房主'+i,f.now());await writeFile(path.join(f.dataDir,code+'.json'),JSON.stringify(room.record));}
  const first=await (await fetch(f.endpoint()+'/api/rooms')).json();assert.equal(first.rooms.length,40);assert.ok(first.nextCursor);
  const second=await (await fetch(f.endpoint()+'/api/rooms?cursor='+first.nextCursor)).json();assert.equal(second.rooms.length,2);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.rooms,...second.rooms].map(v=>v.code)).size,42);
  assert.equal((await fetch(f.endpoint()+'/api/rooms?cursor=invalid')).status,400);
}));

test('Node a failed disconnect checkpoint cannot grant a fresh deadline when storage recovers',()=>scenario(async f=>{
  const {host,token,code}=await f.create(),unavailable=f.dataDir+'-unavailable',originalError=console.error;
  // Simulate temporary storage loss, without modifying permissions or production files.
  await rename(f.dataDir,unavailable);console.error=()=>{};
  try{await host.close();}finally{console.error=originalError;await rename(unavailable,f.dataDir);}
  f.advance(HOST_RETENTION+1);const late=await f.join(code,token);assert.ok(['closed','error'].includes(late.messages.at(-1).type));assert.equal(f.app.rooms.get(code).record.closed,true);
  assert.equal(JSON.parse(await readFile(path.join(f.dataDir,code+'.json'),'utf8')).closed,true);
}));
