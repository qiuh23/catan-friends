import test from 'node:test';
import assert from 'node:assert/strict';
import {Room} from '../shared/room.js';
import {securityConfig,adminAuthorized,emptyModeration,disposition,applyModeration,inspectRoom,pruneModeration,DAY} from '../shared/moderation.js';
const secret='local-test-admin-'.repeat(3),config=securityConfig({SECURITY_ADMIN_TOKEN:secret,MODERATION_RETENTION_DAYS:'30'});
function fixture(){const room=new Room(),a=room.join('host','原昵称'),b=room.join('guest','朋友');room.presence([a,b]);room.handle(a,{id:'chat-1',action:{type:'chat',text:'需核实的消息'}});return {room,a,b};}
const input=(action,extra={})=>({action,id:crypto.randomUUID(),reason:'人工核实后处置',...extra});
test('confirmed contact/90-day defaults are public; independent admin token and valid retention remain mandatory',async()=>{
  assert.deepEqual(securityConfig(),{contact:'qiutian0808@163.com',retentionDays:90,adminReady:false,chatDays:7,chatLimit:100});
  for(const env of [{SECURITY_ADMIN_TOKEN:secret,MODERATION_RETENTION_DAYS:''},{MODERATION_RETENTION_DAYS:'30'},{SECURITY_ADMIN_TOKEN:'short',MODERATION_RETENTION_DAYS:'30'},{SECURITY_ADMIN_TOKEN:secret,MODERATION_RETENTION_DAYS:'-1'}])assert.equal(await adminAuthorized('Bearer '+secret,env),false);
  const env={SECURITY_ADMIN_TOKEN:secret,MODERATION_RETENTION_DAYS:'30'};assert.equal(await adminAuthorized('Bearer '+secret,env),true);assert.equal(await adminAuthorized('Bearer '+secret+'x',env),false);
  assert.equal(securityConfig({REPORT_CONTACT:'javascript:bad'}).contact,'');
  assert.equal(securityConfig({REPORT_CONTACT:''}).contact,'');assert.equal(securityConfig({MODERATION_RETENTION_DAYS:''}).retentionDays,null);
});
test('stationmaster can inspect only public data, hide chat, reset names, restrict/restore identities and close without changing seats or RNG',()=>{
  const {room,a,b}=fixture(),random=structuredClone(room.record.random);let state=emptyModeration();
  const messageId=room.record.chat[0].id;
  const hidden=disposition(room,state,input('hide-chat',{messageId}),config);state=hidden.state;applyModeration(room,state);assert.equal(room.record.chat.length,0);assert.equal(state.audit[0].evidence.text,'需核实的消息');
  state=disposition(room,state,input('reset-name',{memberId:a}),config).state;applyModeration(room,state);assert.equal(room.record.game.players[0].name,'成员'+a.slice(0,8));assert.equal(room.record.game.players[0].id,a);
  const banned=input('restrict-member',{memberId:b});state=disposition(room,state,banned,config).state;applyModeration(room,state);
  assert.throws(()=>room.join('guest','朋友'),error=>error.code==='IDENTITY_REVOKED');assert.equal(room.snapshot(b).type,'removed');
  assert.throws(()=>room.handle(b,{id:'b-chat',action:{type:'chat',text:'不能发布'}}),/限制/);assert.deepEqual(room.record.random,random);
  state=disposition(room,state,input('restore-member',{memberId:b}),config).state;applyModeration(room,state);assert.equal(room.join('guest','朋友'),b);
  const inspected=inspectRoom(room,state);assert.equal(inspected.players.length,2);for(const field of ['"random"','"key"','"nonce"','"hand"','"deck"','"identities"','"receipts"'])assert.ok(!JSON.stringify(inspected).includes(field),field);
  const close=input('close-room');state=disposition(room,state,close,config).state;applyModeration(room,state);assert.equal(room.record.closed,true);assert.equal(room.record.game,undefined);
  assert.equal(disposition(room,state,close,config).result.duplicate,true);
});
test('malformed/unknown disposition, oversized reasons and missing targets cannot change ledger or game',()=>{
  const {room}=fixture(),state=emptyModeration(),before=structuredClone(room.record);
  for(const action of [input('unknown'),input('close-room',{reason:''}),input('close-room',{reason:'x'.repeat(201)}),input('hide-chat',{messageId:'missing'}),input('restrict-member',{memberId:'missing'}),input('close-room',{state:room.record})])assert.throws(()=>disposition(room,state,action,config));
  assert.deepEqual(state,emptyModeration());assert.deepEqual(room.record,before);
});
test('explicit retention cleans audit evidence, held evidence survives until release; enforcement survives older game restore',()=>{
  const {room,b}=fixture(),backup=structuredClone(room.record),now=Date.now();
  const hidden=disposition(room,emptyModeration(),input('hide-chat',{messageId:room.record.chat[0].id}),config,now),target=hidden.state.audit[0].id;
  const held=disposition(room,hidden.state,input('hold',{eventId:target,held:true}),config,now+1);
  const restricted=disposition(room,held.state,input('restrict-member',{memberId:b}),config,now+2);
  const old=new Room(backup);applyModeration(old,restricted.state);assert.equal(old.record.chat.length,0);assert.throws(()=>old.join('guest','朋友'),/限制/);
  const expired=pruneModeration(structuredClone(restricted.state),now+31*DAY);assert.ok(expired.audit.some(event=>event.id===target));assert.ok(expired.restricted.includes(b));
  const released=disposition(old,expired,input('hold',{eventId:target,held:false}),config,now+31*DAY);pruneModeration(released.state,now+31*DAY+1);assert.ok(!released.state.audit.some(event=>event.id===target));
});
