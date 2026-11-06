import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {WebSocket} from 'ws';
import {createServer} from '../server/index.js';
import {createGame,botAction,act} from '../shared/game.js';
import {RuntimeClient} from './runtime-client.js';
const security={SECURITY_ADMIN_TOKEN:'node-local-test-'.repeat(3),MODERATION_RETENTION_DAYS:'30',REPORT_CONTACT:'report@example.test'};
test('Node real sockets: concurrent chat/game, persisted player limits, RNG failed commit/retry/restart and independent moderation',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'catan-secure-node-'));let app,clients=[];
  const start=async()=>{app=await createServer({port:0,dataDir,security,botDelay:60000});};await start();
  const origin=()=>`http://127.0.0.1:${app.port}`;
  const join=async(code,token)=>{const c=new RuntimeClient(new WebSocket(origin()+`/api/rooms/${code}/ws`));clients.push(c);c.ws.addEventListener('open',()=>c.ws.send(JSON.stringify({type:'hello',token,name:'朋友'})));await c.wait(message=>['state','error'].includes(message.type));return c;};
  let code;
  const admin=async(input,authorization='Bearer '+security.SECURITY_ADMIN_TOKEN)=>fetch(origin()+`/api/stationmaster/rooms/${code}`,{method:'POST',headers:{Authorization:authorization},body:JSON.stringify({id:crypto.randomUUID(),...input})});
  try{
    const tokens=Array.from({length:3},()=>crypto.randomUUID()),created=await fetch(origin()+'/api/rooms',{method:'POST',body:JSON.stringify({token:tokens[0],name:'房主'})});({code}=await created.json());
    const [a,b,c]=await Promise.all(tokens.map(token=>join(code,token)));await a.wait(message=>message.type==='state'&&message.state.players.length===3);
    const revision=app.rooms.get(code).record.revision;
    const results=await Promise.all([a.request({type:'chat',text:'甲同时发言'},{revision}),b.request({type:'chat',text:'乙同时发言'},{revision}),c.request({type:'chat',text:'丙同时发言'},{revision}),a.request({type:'ready',ready:true},{revision})]);
    assert.ok(results.every(({result})=>result.type==='ack'));assert.equal(app.rooms.get(code).record.chat.length,3);assert.equal(app.rooms.get(code).record.revision,revision+1);
    const first=results[0].envelope;await a.act(first.action,first);assert.equal(app.rooms.get(code).record.chat.length,3);
    for(let i=0;i<4;i++)await a.act({type:'chat',text:'甲'+i});assert.equal((await a.request({type:'chat',text:'被限流'})).result.code,'CHAT_LIMITED');
    assert.equal((await admin({action:'inspect'},'Bearer '+tokens[0])).status,403);
    const messageId=app.rooms.get(code).record.chat[0].id,memberId=b.state.state.me;
    assert.equal((await admin({action:'hide-chat',messageId,reason:'已人工核实'})).status,200);await c.wait(message=>message.type==='state'&&!message.state.chat.some(chat=>chat.id===messageId));
    assert.equal((await admin({action:'reset-name',memberId,reason:'昵称处置'})).status,200);
    assert.equal((await admin({action:'restrict-member',memberId,reason:'持续滥用'})).status,200);await b.wait(message=>message.type==='removed');
    const banned=await join(code,tokens[1]);assert.equal(banned.messages.at(-1).code,'IDENTITY_REVOKED');
    const inspected=await (await admin({action:'inspect'})).json();for(const field of ['"random"','"key"','"nonce"','"hand"','"identities"','"deck"'])assert.ok(!JSON.stringify(inspected).includes(field));
    assert.equal((await admin({action:'restore-member',memberId,reason:'解除身份限制'})).status,200);
    // Drive the real authority to a roll without spending chat quota.
    const room=app.rooms.get(code);for(const p of room.record.game.players)p.ready=true;
    room.record.random=createGame({},Array(11).fill(23)).random;
    room.record.game=room.gameAction(room.record.game,room.record.hostId,{type:'start'});
    while(room.record.game.phase.startsWith('setup')){const g=room.record.game;room.record.game=room.gameAction(g,g.players[g.turn].id,botAction(g,g.players[g.turn].id));}
    // Test-only hook makes the actual atomic-file checkpoint fail after the draw.
    const realHandle=room.handle.bind(room),file=path.join(dataDir,code+'.json'),before=structuredClone(room.record),random=structuredClone(before.random);
    room.handle=(...args)=>{const ack=realHandle(...args);mkdirSync(file+'.tmp');room.handle=realHandle;return ack;};
    const failed=await a.request({type:'roll'},{revision:before.revision});assert.equal(failed.result.type,'error');assert.equal(failed.result.message,'服务暂时不可用，请稍后重试。');assert.deepEqual(room.record.random,random);assert.ok(!room.record.receipts.some(entry=>entry.id===failed.envelope.id));
    await rm(file+'.tmp',{recursive:true});const expected=act({...before.game,random:before.random},before.hostId,{type:'roll'});
    await a.act(failed.envelope.action,failed.envelope);assert.deepEqual(room.record.game.dice,expected.dice);assert.deepEqual(room.record.random,expected.random);
    const afterRoll=structuredClone(room.record);await a.act(failed.envelope.action,failed.envelope);assert.deepEqual(room.record.random,afterRoll.random);
    for(const client of clients)client.close();await app.close();await start();
    const restored=await join(code,tokens[0]);assert.deepEqual(app.rooms.get(code).record.random,afterRoll.random);assert.deepEqual(restored.state.state.dice,afterRoll.game.dice);
    assert.equal((await restored.request({type:'chat',text:'重启后仍限流'})).result.code,'CHAT_LIMITED');
    assert.ok(!restored.state.state.chat.some(message=>message.id===messageId));assert.ok(!JSON.stringify(restored.messages).includes('"random"'));
    await restored.act(failed.envelope.action,failed.envelope);assert.deepEqual(app.rooms.get(code).record.random,afterRoll.random);
    // Restore only the older game record. The separate ledger still hides it.
    for(const client of clients)client.close();await app.close();const saved=JSON.parse(await readFile(file,'utf8'));saved.chat.push({id:messageId,seq:999,playerId:memberId,name:'旧昵称',text:'不能复活',sentAt:Date.now()});await writeFile(file,JSON.stringify(saved));await start();
    const afterBackup=await join(code,tokens[0]);assert.ok(!afterBackup.state.state.chat.some(message=>message.id===messageId));
    assert.equal((await admin({action:'close-room',reason:'核实后关闭'})).status,200);await afterBackup.wait(message=>message.type==='closed');
    assert.ok(JSON.parse(await readFile(path.join(dataDir,'moderation',code+'.json'),'utf8')).audit.length>0);
  }finally{for(const c of clients)c.close();await app.close();await rm(dataDir,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});
