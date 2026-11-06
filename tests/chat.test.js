import test from 'node:test';
import assert from 'node:assert/strict';
import {Room} from '../shared/room.js';
import {CHAT_DAYS,DAY} from '../shared/moderation.js';
const now=1_000_000;
function fixture(){const room=new Room(undefined,now),a=room.join('host','甲',now),b=room.join('guest','乙',now);room.presence([a,b],now);return {room,a,b};}
const message=(room,action,extra={})=>({id:crypto.randomUUID(),revision:room.record.revision,action,...extra});
test('same-version multi-player chat and gameplay commute in either order; chat never changes game or game receipts',()=>{
  for(const chatFirst of [true,false]){
    const {room,a,b}=fixture(),chat=message(room,{type:'chat',text:'同时发言'}),ready=message(room,{type:'ready',ready:true});
    const revision=room.record.revision,random=structuredClone(room.record.random);
    if(chatFirst){room.handle(b,chat,now);room.handle(a,ready,now);}else {room.handle(a,ready,now);room.handle(b,chat,now);}
    assert.equal(room.record.revision,revision+1);assert.equal(room.record.chat.length,1);assert.equal(room.record.receipts.length,1);assert.deepEqual(room.record.random,random);
    const before=structuredClone(room.record);room.handle(b,chat,now);assert.deepEqual(room.record,before);
    const restored=new Room(JSON.parse(JSON.stringify(room.record)),now);restored.handle(b,chat,now);assert.deepEqual(restored.record,room.record);
  }
});
test('player token bucket survives reconnect/restart; duplicates and invalid messages consume no quota or random words',()=>{
  const {room,a,b}=fixture(),first=message(room,{type:'chat',text:'第一条'});room.handle(a,first,now);
  const before=structuredClone(room.record);for(let i=0;i<10;i++)room.handle(a,first,now);assert.deepEqual(room.record,before);
  for(const text of ['', ' '.repeat(4),'x'.repeat(201),'控制\u0000']){const copy=structuredClone(room.record);assert.throws(()=>room.handle(a,message(room,{type:'chat',text}),now));assert.deepEqual(room.record,copy);}
  for(let i=0;i<4;i++)room.handle(a,message(room,{type:'chat',text:'消息'+i}),now);
  const saturated=structuredClone(room.record),retry=message(room,{type:'chat',text:'稍后发送'});
  assert.throws(()=>room.handle(a,retry,now),error=>error.code==='CHAT_LIMITED');assert.deepEqual(room.record,saturated);
  room.handle(b,message(room,{type:'chat',text:'乙不受甲限流影响'}),now);
  const restored=new Room(JSON.parse(JSON.stringify(room.record)),now);assert.equal(restored.join('host','甲',now),a);
  assert.throws(()=>restored.handle(a,retry,now),/过快/);restored.handle(a,retry,now+2000);assert.equal(restored.record.chat.at(-1).text,'稍后发送');
});
test('bounded timestamped reconnect history expires; ordinary messages cannot evict successful game receipts',()=>{
  const {room,a}=fixture(),ready=message(room,{type:'ready',ready:true});room.handle(a,ready,now);
  for(let i=0;i<110;i++)room.handle(a,message(room,{type:'chat',text:'聊天'+i}),now+i*2000);
  assert.equal(room.record.chat.length,100);assert.equal(room.record.chatSequence,110);
  room.handle(a,ready,now+220000);assert.equal(room.record.game.players[0].ready,true);assert.equal(room.record.receipts.length,1);
  assert.equal(room.chatHistory(now+220000).length,100);assert.equal(room.chatHistory(now+CHAT_DAYS*DAY+220000).length,0);
  assert.deepEqual(room.snapshot(a,[],now+220000).state.chat,room.chatHistory(now+220000));
});
