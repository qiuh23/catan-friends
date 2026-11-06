import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../shared/room.js';
import { createRoomFromInput } from '../shared/room-create.js';
import { NICKNAMES, assignNickname, siteEdition } from '../shared/site-policy.js';
import { applyModeration, disposition, emptyModeration, securityConfig } from '../shared/moderation.js';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';

test('site configuration fails closed and creation cannot choose another policy',async()=>{
  for(const [edition,backend] of [[undefined,'aliyun'],['global','aliyun'],['cn','cloudflare'],['invalid','local']])assert.throws(()=>siteEdition(edition,backend));
  await assert.rejects(createRoomFromInput({token:crypto.randomUUID(),name:'自定义',siteEdition:'global'},Date.now(),'cn'),/固定昵称编号/);
  await assert.rejects(createRoomFromInput({token:crypto.randomUUID(),nicknameId:'other'},Date.now(),'cn'),/固定昵称编号/);
  const room=await createRoomFromInput({token:crypto.randomUUID(),nicknameId:'catan-01',siteEdition:'global'},Date.now(),'cn');
  assert.equal(room.record.game.players[0].name,'白塔');assert.equal(room.siteEdition,'cn');
});

test('domestic names are unique across offline seats and bots, stable through recovery/rematch, and do not advance game random',()=>{
  const room=new Room(undefined,Date.now(),'cn'),random=structuredClone(room.record.random);
  const a=room.join('a',undefined,Date.now(),'catan-01'),b=room.join('b',undefined,Date.now(),'catan-01');
  assert.notEqual(room.record.game.players[0].name,room.record.game.players[1].name);
  room.handle(a,{id:'bot',revision:room.record.revision,action:{type:'addBot'}});
  assert.equal(new Set(room.record.game.players.map(p=>p.nicknameId)).size,3);
  assert.deepEqual(room.record.random,random);
  const before=structuredClone(room.record.game.players),saved=structuredClone(room.record);
  const restored=new Room(saved,Date.now(),'cn');assert.equal(restored.join('a','old free name'),a);
  assert.deepEqual(restored.record.game.players,before);
  restored.record.game.phase='finished';restored.handle(a,{id:'again',revision:restored.record.revision,action:{type:'rematch'}});
  assert.deepEqual(restored.record.game.players.map(p=>[p.id,p.nicknameId,p.name]),before.map(p=>[p.id,p.nicknameId,p.name]));
  const exhausted=assignNickname(NICKNAMES.map(n=>({...n,nicknameId:n.id})));
  assert.equal(exhausted.nicknameBadge,2);assert.ok(NICKNAMES.some(n=>n.name===exhausted.name));
});

test('legacy data migration preserves game progress, credentials, private audit and event cursor; old text never enters a public projection',()=>{
  const old=new Room(),id=old.join('credential','旧自由昵称');
  old.record.chat=[{id:'old',name:'旧自由昵称',playerId:id,text:'旧聊天',sentAt:Date.now()}];
  old.record.chatReceipts=[{actor:id,id:'cached'}];old.record.game.log=[{id:1,text:'旧自由昵称 joined'}];
  old.record.game.presentation={epoch:'old-epoch',sequence:8,events:[{id:8,text:'旧自由昵称',actorId:id,kind:'trade',targets:[]}]};
  old.record.game.players[0].hand.wood=3;delete old.record.siteEdition;
  const random=structuredClone(old.record.random),room=new Room(structuredClone(old.record),Date.now(),'cn');
  assert.equal(room.record.identities.credential,id);assert.equal(room.record.game.players[0].hand.wood,3);
  assert.deepEqual(room.record.random,random);assert.equal(room.record.game.presentation.sequence,8);
  assert.ok(room.record.legacyPublicText.log.length);assert.ok(!JSON.stringify(room.snapshot(id)).includes('旧'));
  for(const action of [{type:'chat',text:'旧聊天'},{type:'phrase',phraseId:'x'},{type:'reaction',emojiId:'x'}])assert.throws(()=>room.handle(id,{id:'cached',action}),/^Error: 当前站点不提供玩家交流功能。$/);
  const config=securityConfig({SECURITY_ADMIN_TOKEN:'a'.repeat(40)}),state=emptyModeration();
  state.audit.push({id:'private',expiresAt:Date.now()+10000,evidence:{name:'旧自由昵称'}});state.names[id]='old reset name';
  applyModeration(room,state);const stable=room.record.game.players[0].name;applyModeration(room,state);assert.equal(room.record.game.players[0].name,stable);
  assert.throws(()=>disposition(room,state,{action:'reset-name',id:'reset',reason:'test',memberId:id},config),/不提供交流处置或安全审计/);
  assert.ok(NICKNAMES.some(n=>n.name===room.record.game.players[0].name));
  assert.equal(state.audit[0].evidence.name,'旧自由昵称');assert.ok(!JSON.stringify(room.summary('ABC234')).includes('旧'));
});

test('global custom names, free chat and replay survive restart',()=>{
  const room=new Room(),id=room.join('global','自由昵称');room.handle(id,{id:'hello',action:{type:'chat',text:'自由聊天'}});
  const restored=new Room(structuredClone(room.record));assert.equal(restored.join('global','other'),id);
  assert.equal(restored.snapshot(id).state.players[0].name,'自由昵称');assert.equal(restored.snapshot(id).state.chat[0].text,'自由聊天');
  assert.equal(restored.handle(id,{id:'hello',action:{type:'chat',text:'自由聊天'}}).ok,true);assert.equal(restored.record.chat.length,1);
});

test('real domestic HTTP/WebSocket rejects forged names, edition overrides and old communication retries; restart keeps the identity',async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'catan-cn-'));let app=await createServer({port:0,dataDir,siteEdition:'cn'});const sockets=[];
  const token=crypto.randomUUID();
  const create=input=>fetch(`http://127.0.0.1:${app.port}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...input})});
  const connect=async(code,hello)=>{
    const messages=[],ws=new WebSocket(`ws://127.0.0.1:${app.port}/api/rooms/${code}/ws`);sockets.push(ws);
    ws.on('message',raw=>messages.push(JSON.parse(raw)));await new Promise(r=>ws.on('open',r));ws.send(JSON.stringify({type:'hello',token,...hello}));
    const wait=async predicate=>{for(let i=0;i<100;i++){const found=messages.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,10));}throw Error('No response');};
    return {ws,messages,wait};
  };
  try{
    assert.equal((await create({name:'forged',siteEdition:'global'})).status,400);
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/api/security/contact`)).status,404);
    const created=await create({nicknameId:'catan-01',siteEdition:'global'});assert.equal(created.status,201);const {code}=await created.json();
    await mkdir(path.join(dataDir,'moderation'),{recursive:true});await writeFile(path.join(dataDir,'moderation',code+'.json'),'private old malformed ledger');
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/api/stationmaster/rooms/${code}`,{method:'POST',body:'{}'})).status,404);
    const client=await connect(code,{nicknameId:'catan-01'}),first=await client.wait(m=>m.type==='state');
    const id=first.state.me,room=app.rooms.get(code),random=structuredClone(room.record.random);room.record.receipts.push({actor:id,id:'old-success'});
    for(const [i,action] of [{type:'chat',text:'secret'},{type:'phrase',phraseId:'hello'},{type:'emoji',emojiId:'smile'}].entries()){
      client.ws.send(JSON.stringify({type:'action',id:'old-success',action}));
      for(let n=0;n<100&&client.messages.filter(m=>m.type==='error').length<=i;n++)await new Promise(r=>setTimeout(r,10));
      assert.equal(client.messages.filter(m=>m.type==='error')[i].message,'当前站点不提供玩家交流功能。');
    }
    assert.deepEqual(room.record.random,random);assert.equal(room.record.revision,first.revision);
    const bad=await connect(code,{token:crypto.randomUUID(),name:'forged'});assert.match((await bad.wait(m=>m.type==='error')).message,/固定昵称编号/);
    client.ws.close();await app.close();app=await createServer({port:0,dataDir,siteEdition:'cn'});
    const again=await connect(code,{name:'legacy reconnect name'}),restored=await again.wait(m=>m.type==='state');
    assert.equal(restored.state.me,id);assert.equal(restored.state.players[0].name,'白塔');assert.deepEqual(restored.state.chat,[]);
    assert.equal(await readFile(path.join(dataDir,'moderation',code+'.json'),'utf8'),'private old malformed ledger');
  }finally{for(const ws of sockets)ws.terminate();await app.close();await rm(dataDir,{recursive:true,force:true});}
});
