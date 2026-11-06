import test from 'node:test';
import assert from 'node:assert/strict';
import { gameLobbyURL, roomAvailability, remainingTime, rulesLabel, leaveDescription, mergeRoomPages } from '../src/room-ui.js';

test('lobby return only uses the verified server destination and no identity',()=>{
  assert.equal(gameLobbyURL('aliyun'),null); // Global test build exposes only its own lobby.
  assert.equal(gameLobbyURL('cloudflare'),'https://magical-athlete.qiuh23.workers.dev/lobby/');
  assert.equal(gameLobbyURL('local'),null);assert.equal(gameLobbyURL('https://evil.example'),null);
  for(const backend of ['cloudflare']){const url=new URL(gameLobbyURL(backend));assert.equal(url.search,'');assert.equal(url.hash,'');}
});
test('public room list differentiates joining, full, playing and returning',()=>{
  const room={phase:'lobby',playerCount:3,maxPlayers:4};
  assert.deepEqual(roomAvailability(room),{label:'加入房间',disabled:false});
  assert.equal(roomAvailability({...room,playerCount:4}).label,'已满');
  assert.equal(roomAvailability({...room,phase:'action'}).label,'进行中');
  assert.equal(roomAvailability({...room,phase:'finished'}).label,'已结束');
  assert.equal(roomAvailability({...room,phase:'action',status:'paused'}).label,'已暂停');
  assert.deepEqual(roomAvailability({...room,phase:'action'},true),{label:'原身份返回',disabled:false});
});
test('countdown follows server time instead of client wall clock and never extends deadlines',()=>{
  assert.equal(remainingTime(10000,1000,50000,52000),'0 分 07 秒');
  assert.equal(remainingTime(10000,1000,50000,99999),'0 分 00 秒');
  assert.equal(remainingTime(null,1000,50000),null);
  assert.equal(remainingTime(4*3600000,0,50000,50000),'4 小时 0 分');
});
test('rules and leaving describe actual seat and room semantics',()=>{
  assert.equal(rulesLabel(),'经典基础版');assert.match(rulesLabel({harbormaster:true}),/卡坦港口/);
  assert.match(rulesLabel({playerExpansion:'five-six-2025'}),/5–6 人扩充/);
  assert.match(leaveDescription({lobby:true,host:false}),/释放席位/);
  assert.match(leaveDescription({lobby:false,host:true,paused:true}),/重连不延长/);
  assert.match(leaveDescription({lobby:false,host:true,practice:true}),/10 分钟/);
});
test('directory pagination replaces updated duplicates and preserves previous pages',()=>{
  assert.deepEqual(mergeRoomPages([{code:'ABC234',playerCount:2},{code:'DEF567',playerCount:3}],[{code:'ABC234',playerCount:4},{code:'GHJ234',playerCount:1}]),[
    {code:'ABC234',playerCount:4},{code:'DEF567',playerCount:3},{code:'GHJ234',playerCount:1},
  ]);
});
