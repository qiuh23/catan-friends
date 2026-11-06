import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createGame,act,botAction} from '../shared/game.js';
import {RuntimeClient} from '../tests/runtime-client.js';
const persistence=await mkdtemp(path.join(os.tmpdir(),'catan-secure-worker-'));
const bundle=await build({entryPoints:['tests/fixtures/secure-worker.js'],bundle:true,write:false,format:'esm',platform:'neutral'});
const bindings={BACKEND_ID:'local',REPORT_CONTACT:'report@example.test',MODERATION_RETENTION_DAYS:'30',SECURITY_ADMIN_TOKEN:'worker-local-test-'.repeat(3)};
let mf,clients=[];
async function start(){mf=new Miniflare(convertV4MiniflareOptions({name:'secure-catan-test',script:bundle.outputFiles[0].text,modules:true,compatibilityDate:'2026-10-20',durableObjects:{ROOMS:{className:'CatanTestRoom',useSQLite:true}},resourcePersistencePath:persistence,bindings}));await mf.ready;}
async function stop(){for(const client of clients)client.close();clients=[];await mf.dispose();}
async function join(code,token){const response=await mf.dispatchFetch(`https://test/api/rooms/${code}/ws`,{headers:{Upgrade:'websocket'}});assert.equal(response.status,101);const socket=response.webSocket,c=new RuntimeClient(socket);clients.push(c);socket.accept();socket.send(JSON.stringify({type:'hello',token,name:'朋友'}));await c.wait(message=>['state','error'].includes(message.type));return c;}
let code;
async function stub(){const ns=await mf.getDurableObjectNamespace('ROOMS');return ns.get(ns.idFromName(code));}
async function fixture(route,record){return (await stub()).fetch('https://test/__fixture/'+route,record?{method:'POST',body:JSON.stringify(record)}:{});}
async function read(){return (await fixture('read')).json();}
async function admin(input,authorization='Bearer '+bindings.SECURITY_ADMIN_TOKEN){return mf.dispatchFetch(`https://test/api/stationmaster/rooms/${code}`,{method:'POST',headers:{Authorization:authorization},body:JSON.stringify({id:crypto.randomUUID(),...input})});}
try{
  await start();
  const tokens=Array.from({length:6},()=>crypto.randomUUID());
  const created=await mf.dispatchFetch('https://test/api/rooms',{method:'POST',body:JSON.stringify({token:tokens[0],name:'房主',options:{playerExpansion:'five-six-2025'}})});assert.equal(created.status,201);({code}=await created.json());
  const players=[];for(const token of tokens)players.push(await join(code,token));const [a,b]=players;
  const before=(await read()).record,revision=before.revision;
  const concurrent=await Promise.all([...players.map((p,i)=>p.request({type:'chat',text:'并发聊天'+i},{revision})),a.request({type:'ready',ready:true},{revision})]);assert.ok(concurrent.every(({result})=>result.type==='ack'));
  assert.equal((await read()).record.chat.length,6);assert.equal((await read()).record.revision,revision+1);
  const first=concurrent[0].envelope;await a.act(first.action,first);assert.equal((await read()).record.chat.length,6);
  assert.equal((await admin({action:'inspect'},'Bearer '+tokens[0])).status,403);
  const messageId=(await read()).record.chat[0].id,memberId=b.state.state.me;
  assert.equal((await admin({action:'hide-chat',messageId,reason:'人工核实'})).status,200);
  assert.equal((await admin({action:'reset-name',memberId,reason:'昵称处置'})).status,200);
  assert.equal((await admin({action:'restrict-member',memberId,reason:'持续滥用'})).status,200);await b.wait(message=>message.type==='removed');assert.equal((await join(code,tokens[1])).messages.at(-1).code,'IDENTITY_REVOKED');
  const inspected=await (await admin({action:'inspect'})).json();for(const field of ['"random"','"nonce"','"key"','"hand"','"deck"','"identities"'])assert.ok(!JSON.stringify(inspected).includes(field),field);
  // Prepare a deterministic roll on the actual workerd authority. The fixture
  // route is only available via this local test-only namespace, never production.
  const prepared=(await read()).record;prepared.random=createGame({},Array(11).fill(91)).random;for(const p of prepared.game.players)p.ready=true;
  prepared.game=act({...prepared.game,random:prepared.random},prepared.hostId,{type:'start'});
  while(prepared.game.phase.startsWith('setup')){const g=prepared.game;prepared.game=act(g,g.players[g.turn].id,botAction(g,g.players[g.turn].id));}
  prepared.random=prepared.game.random;delete prepared.game.random;await fixture('replace',prepared);
  const baseline=(await read()).record,random=structuredClone(baseline.random),expected=act({...baseline.game,random:baseline.random},baseline.hostId,{type:'roll'});
  await fixture('fail-next-command');const failed=await a.request({type:'roll'},{revision:baseline.revision});assert.equal(failed.result.type,'error');assert.equal(failed.result.message,'服务暂时不可用，请稍后重试。');assert.deepEqual((await read()).record.random,random);
  assert.ok(!JSON.stringify(failed.result).includes('injected-private-state'));
  await a.act(failed.envelope.action,failed.envelope);assert.deepEqual((await read()).record.random,expected.random);assert.deepEqual((await read()).record.game.dice,expected.dice);
  await a.act(failed.envelope.action,failed.envelope);const committed=(await read()).record;assert.deepEqual(committed.random,expected.random);
  for(let i=0;i<4;i++)await a.act({type:'chat',text:'限流消息'+i});assert.equal((await a.request({type:'chat',text:'超出额度'})).result.code,'CHAT_LIMITED');
  await stop();await start();
  const restored=await join(code,tokens[0]);assert.deepEqual((await read()).record.random,committed.random);assert.deepEqual(restored.state.state.dice,expected.dice);assert.ok(!restored.state.state.chat.some(message=>message.id===messageId));
  assert.equal((await restored.request({type:'chat',text:'重启仍限流'})).result.code,'CHAT_LIMITED');assert.equal((await join(code,tokens[1])).messages.at(-1).code,'IDENTITY_REVOKED');
  await restored.act(failed.envelope.action,failed.envelope);assert.deepEqual((await read()).record.random,expected.random);
  const old=(await read()).record;old.chat.push({id:messageId,seq:999,playerId:memberId,name:'旧昵称',text:'不得复活',sentAt:Date.now()});await fixture('replace',old);await stop();await start();
  const recovered=await join(code,tokens[0]);assert.ok(!recovered.state.state.chat.some(message=>message.id===messageId));
  for(const client of clients)for(const message of client.messages)for(const field of ['"random"','"nonce"','"words"','"key"'])assert.ok(!JSON.stringify(message).includes(field),field);
  assert.equal((await admin({action:'close-room',reason:'人工核实后关闭'})).status,200);await recovered.wait(message=>message.type==='closed');const closed=await read();assert.ok(closed.record.closed);assert.ok(closed.moderation.audit.length>0);assert.equal(closed.record.game,undefined);
  console.log('Local workerd passed: six simultaneous chatters + gameplay, exact retry after failed random commit, process restart, persisted stream/limits/history, private projections, independent admin permissions and durable dispositions.');
}finally{if(mf)await stop();await rm(persistence,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
