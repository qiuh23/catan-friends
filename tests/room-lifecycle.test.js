import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,HOST_RETENTION,PAUSE_RETENTION,PRACTICE_RETENTION} from '../shared/room.js';
import {createGame,addPlayer} from '../shared/game.js';

const t0=1_000_000;
function roomFixture({active=false,practice=false}={}) {
  const room=new Room(undefined,t0),host=room.join('host-hash','房主',t0);room.record.practice=practice;
  let peers=[];
  if(!practice)peers=[room.join('guest-a','甲',t0),room.join('guest-b','乙',t0)];
  room.presence([host,...peers],t0);
  if(active){for(const p of room.record.game.players)p.ready=true;send(room,host,{type:'start'},t0);}
  return {room,host,peers};
}
function send(room,id,action,now=t0){return room.handle(id,{id:crypto.randomUUID(),revision:room.record.revision,action},now);}

test('normal host deadline begins at last effective connection and guests or bots cannot extend it',()=>{
  const {room,host,peers}=roomFixture();room.presence([host,host,...peers],t0+1);room.presence([host,...peers],t0+1000);assert.equal(room.deadline(),null);
  room.presence(peers,t0+2000);const until=t0+2000+HOST_RETENTION;assert.equal(room.deadline(),until);
  send(room,peers[0],{type:'chat',text:'其他玩家仍在'},t0+20000);room.presence(peers,t0+30000);assert.equal(room.deadline(),until);
  assert.equal(room.expire(until-1),false);assert.equal(room.expire(until),true);assert.equal(room.record.closed,true);
});

test('actual AI turns update activity without renewing an offline host deadline',()=>{
  const {room,host,peers}=roomFixture({active:true});room.record.game.players[1].bot=true;room.record.game.turn=1;room.record.game.phase='roll';
  room.presence(peers,t0+100);const until=room.deadline();assert.equal(room.tick(t0+10000),true);
  assert.equal(room.record.updatedAt,t0+10000);assert.equal(room.deadline(),until);assert.equal(room.expire(until),true);
});

test('return within normal retention restores identity, but returning exactly at deadline cannot revive a room',()=>{
  const {room,host,peers}=roomFixture();room.presence(peers,t0+100);const first=room.deadline();
  assert.equal(room.join('host-hash','昵称不覆盖',first-1),host);room.presence([host,...peers],first-1);assert.equal(room.deadline(),null);
  room.presence(peers,first+100);const second=room.deadline();assert.equal(second,first+100+HOST_RETENTION);
  room.presence([host,...peers],second);assert.equal(room.record.closed,true);
  assert.throws(()=>room.join('host-hash','房主',second+1),/保留时间/);
});

test('paused room starts a fixed four-hour limit at first offline and reconnects never extend that pause',()=>{
  const {room,host,peers}=roomFixture({active:true});send(room,host,{type:'pause'},t0+100);assert.equal(room.deadline(),null);
  room.presence(peers,t0+1000);const until=t0+1000+PAUSE_RETENTION;assert.equal(room.deadline(),until);assert.equal(room.record.pauseOfflineAt,t0+1000);
  room.presence([host,...peers],t0+2000);assert.equal(room.deadline(),until);
  room.presence(peers,t0+3000);assert.equal(room.deadline(),until);
  room.presence([host,...peers],until-1);assert.equal(room.deadline(),until);assert.equal(room.expire(until),true);
});

test('resuming clears the pause deadline; a later explicitly new pause gets its own first offline',()=>{
  const {room,host,peers}=roomFixture({active:true});send(room,host,{type:'pause'},t0+100);room.presence(peers,t0+200);
  room.presence([host,...peers],t0+500);send(room,host,{type:'resume'},t0+600);assert.equal(room.record.pauseOfflineAt,null);assert.equal(room.deadline(),null);
  send(room,host,{type:'pause'},t0+1000);room.presence(peers,t0+2000);assert.equal(room.deadline(),t0+2000+PAUSE_RETENTION);
  assert.equal(room.nextBot(),null);
});

test('practice stays private, rejects other identities and closes ten minutes after leaving',()=>{
  const {room,host}=roomFixture({practice:true});assert.equal(room.summary('ABCDEF',t0),null);assert.throws(()=>room.join('outsider','外人',t0),/个人练习/);
  room.presence([],t0+1000);const until=t0+1000+PRACTICE_RETENTION;assert.equal(room.deadline(),until);
  assert.equal(room.join('host-hash','原玩家',until-1),host);room.presence([host],until-1);assert.equal(room.deadline(),null);
  room.presence([],until);const final=room.deadline();room.presence([host],final+1);assert.equal(room.record.closed,true);
});

test('online host survives over forty-eight hours; restart uses persisted host time rather than new process time',()=>{
  const {room,host,peers}=roomFixture();room.presence([host,...peers],t0+60*60*60*1000);assert.equal(room.deadline(),null);assert.equal(room.record.closed,undefined);
  const lastSeen=t0+60*60*60*1000,restored=new Room(JSON.parse(JSON.stringify(room.record)),lastSeen+1000);
  restored.presence([],lastSeen+1000,true);assert.equal(restored.record.hostOfflineAt,lastSeen);assert.equal(restored.deadline(),lastSeen+HOST_RETENTION);
  const again=new Room(JSON.parse(JSON.stringify(restored.record)),lastSeen+HOST_RETENTION-1);again.presence([],lastSeen+HOST_RETENTION-1,true);assert.equal(again.deadline(),lastSeen+HOST_RETENTION);
  again.presence([host],lastSeen+HOST_RETENTION);assert.equal(again.record.closed,true);
});

test('kick and lobby leave release seats, revoke old hashes and remove authority; transfer does not reorder seats',()=>{
  const {room,host,peers}=roomFixture();assert.throws(()=>send(room,peers[0],{type:'kick',playerId:peers[1]}),/房主/);
  assert.throws(()=>send(room,host,{type:'leave'}),/转交/);
  send(room,host,{type:'kick',playerId:peers[1]});assert.equal(room.record.game.players.length,2);assert.equal(room.snapshot(peers[1]).type,'removed');assert.throws(()=>room.join('guest-b','乙',t0),/身份已失效/);
  const replacement=room.join('new-guest','新玩家',t0);assert.ok(replacement);const seats=room.record.game.players.map(p=>p.id);
  send(room,host,{type:'transferHost',playerId:peers[0]});assert.deepEqual(room.record.game.players.map(p=>p.id),seats);assert.equal(room.record.hostId,peers[0]);assert.equal(room.record.game.hostId,peers[0]);
  assert.throws(()=>send(room,host,{type:'addBot'}),/房主/);assert.throws(()=>send(room,host,{type:'close'}),/房主/);
  send(room,host,{type:'leave'});assert.equal(room.record.game.players.length,2);assert.throws(()=>room.join('host-hash','旧房主',t0),/身份已失效/);
  assert.throws(()=>send(room,host,{type:'chat',text:'旧权限'}),/身份已失效/);
});

test('in-game leave keeps the seat and token; kick is pre-game only and shutdown removes private data permanently',()=>{
  const {room,host,peers}=roomFixture({active:true});send(room,peers[0],{type:'leave'});assert.equal(room.record.game.players.length,3);assert.equal(room.join('guest-a','甲',t0),peers[0]);
  assert.throws(()=>send(room,host,{type:'kick',playerId:peers[0]}),/开局前/);
  assert.throws(()=>send(room,peers[0],{type:'close'}),/房主/);send(room,host,{type:'close'});
  assert.equal(room.record.closed,true);assert.equal(room.record.game,undefined);assert.equal(room.record.identities,undefined);assert.equal(room.record.chat,undefined);
  const saved=JSON.stringify(room.record);for(const secret of ['host-hash','guest-a','guest-b',peers[0],peers[1],host])assert.ok(!saved.includes(secret));
  const restored=new Room(JSON.parse(saved),t0+10);assert.equal(restored.snapshot(host).type,'closed');assert.equal(restored.summary('ABCDEF'),null);
  assert.throws(()=>restored.join('brand-new','新身份',t0+10),/解散/);assert.throws(()=>restored.tick(t0+10),/解散/);
});

test('legacy records migrate privately with a finite host deadline, preserving identities and base rules',()=>{
  const game=createGame();delete game.options;delete game.targetPoints;delete game.harbormaster;addPlayer(game,'original','原玩家');
  const record={version:1,game,identities:{originalHash:'original'},revision:1,receipts:[],chat:[],updatedAt:t0};
  const room=new Room(record,t0+1000);assert.equal(room.record.version,3);assert.equal(room.record.visibility,'private');assert.equal(room.record.hostId,'original');assert.equal(room.deadline(),t0+HOST_RETENTION);
  assert.equal(room.join('originalHash','恢复',t0+1000),'original');assert.equal(room.snapshot('original').state.targetPoints,10);assert.equal(room.summary('ABCDEF'),null);
  const expired=new Room({...structuredClone(record),hostConnected:false,hostOfflineAt:t0},t0+HOST_RETENTION+1);assert.equal(expired.expire(t0+HOST_RETENTION+1),true);
});
