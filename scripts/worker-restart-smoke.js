// Entirely local: fresh Durable Objects directory and a dedicated loopback port.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const root=fileURLToPath(new URL('../',import.meta.url));
const persistence=await mkdtemp(path.join(os.tmpdir(),'catan-worker-restart-'));
const port=Number(process.env.LOCAL_RESTART_PORT)||8791,origin=`http://127.0.0.1:${port}`;
const count=Number(process.env.TEST_PLAYERS)||3;
assert.ok([3,4,5,6].includes(count),'TEST_PLAYERS must be 3, 4, 5 or 6');
let processHandle,output='';const clients=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(){
  output='';
  processHandle=spawn(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--local','--config',path.join(root,'wrangler.local.jsonc'),'--ip','127.0.0.1','--port',String(port),'--persist-to',persistence],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
  processHandle.stdout.on('data',data=>output+=data);processHandle.stderr.on('data',data=>output+=data);
  for(let i=0;i<120;i++){
    if(processHandle.exitCode!==null)throw new Error(`Local Wrangler stopped: ${output.slice(-2000)}`);
    try {const response=await fetch(origin+'/api/health');if(response.ok)return;}catch{}
    await delay(250);
  }
  throw new Error(`Local Wrangler did not start: ${output.slice(-2000)}`);
}
async function stop(){
  for(const client of clients)client.ws.terminate();clients.length=0;
  if(!processHandle||processHandle.exitCode!==null)return;
  const pid=processHandle.pid;
  if(process.platform==='win32')spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  else process.kill(-pid,'SIGTERM');
  await new Promise(resolve=>{if(processHandle.exitCode!==null)return resolve();processHandle.once('exit',resolve);});
  processHandle=null;
}
async function join(code,token,name){
  const ws=new WebSocket(`${origin.replace('http','ws')}/api/rooms/${code}/ws`),client={ws,messages:[],state:null};clients.push(client);
  ws.on('open',()=>ws.send(JSON.stringify({type:'hello',token,name})));ws.on('message',raw=>{const message=JSON.parse(raw);client.messages.push(message);if(message.type==='state')client.state=message;});
  client.wait=async(predicate,after=0)=>{for(let i=0;i<250;i++){const message=client.messages.slice(after).find(predicate);if(message)return message;await delay(20);}throw new Error('Local Worker state timeout');};
  client.act=async action=>{const id=crypto.randomUUID(),after=client.messages.length;ws.send(JSON.stringify({type:'action',id,revision:client.state.revision,action}));const result=await client.wait(message=>message.id===id,after);assert.equal(result.type,'ack',JSON.stringify(result));await client.wait(message=>message.type==='state',after);};
  await client.wait(message=>message.type==='state');return client;
}
try {
  await start();
  const tokens=Array.from({length:count},()=>crypto.randomUUID());
  const response=await fetch(origin+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:tokens[0],name:'本地恢复房主'})});assert.equal(response.status,201);
  const {code}=await response.json(),names=Array.from({length:count},(_,i)=>`恢复玩家${i+1}`);
  const players=[];for(let i=0;i<count;i++)players.push(await join(code,tokens[i],names[i]));
  const [a]=players;await a.wait(message=>message.type==='state'&&message.state.players.length===count);
  for(let i=1;i<count;i++){await players[i].wait(message=>message.type==='state'&&message.revision===a.state.revision);await players[i].act({type:'ready',ready:true});await a.wait(message=>message.type==='state'&&message.state.players[i]?.ready);}
  await a.act({type:'start'});
  while(a.state.state.phase.startsWith('setup')){
    const active=players[a.state.state.turn],revision=a.state.revision;
    await active.wait(message=>message.type==='state'&&message.revision===revision);
    await active.act(a.state.state.phase==='setup-settlement'?{type:'buildSettlement',vertex:active.state.state.legal.settlement[0]}:{type:'buildRoad',edge:active.state.state.legal.road[0]});
    await a.wait(message=>message.type==='state'&&message.revision>revision);
  }
  for(const player of players)await player.wait(message=>message.type==='state'&&message.state.phase==='roll');
  if(count>=5){
    await a.act({type:'roll'});
    while(['robber','steal'].includes(a.state.state.phase))await a.act(a.state.state.phase==='robber'?{type:'moveRobber',tile:a.state.state.legal.robber[0]}:{type:'steal',victim:a.state.state.legal.victims[0]});
    await a.act({type:'endTurn'});
    for(const player of players)await player.wait(message=>message.type==='state'&&message.state.pairStep==='secondary');
  }
  // A legal coast/desert placement (or the first robber steal) can leave an
  // individual with zero cards. Still compare every private hand after restart.
  assert.ok(players.some(player=>Object.values(player.state.state.players.find(p=>p.id===player.state.state.me).hand).some(amount=>amount>0)));
  const before=players.map(player=>structuredClone(player.state.state));
  await stop();await start();
  for(let i=0;i<count;i++){
    const restored=(await join(code,tokens[i],names[i])).state.state;
    assert.equal(restored.me,before[i].me);assert.equal(restored.phase,before[i].phase);assert.equal(restored.turn,before[i].turn);assert.equal(restored.pairStep,before[i].pairStep);assert.equal(restored.primaryTurn,before[i].primaryTurn);assert.deepEqual(restored.options,before[i].options);assert.deepEqual(restored.board,before[i].board);
    const mine=restored.players.find(player=>player.id===restored.me),previous=before[i].players.find(player=>player.id===before[i].me);
    assert.deepEqual(mine.hand,previous.hand);assert.deepEqual(mine.dev,previous.dev);
    assert.ok(restored.players.filter(player=>player.id!==restored.me).every(player=>player.hand===undefined&&player.dev===undefined));assert.equal(restored.deck,undefined);
  }
  const practiceToken=crypto.randomUUID(),practiceResponse=await fetch(origin+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:practiceToken,name:'暂停恢复练习',practice:true,playerCount:count,options:{friendlyRobber:true,harbormaster:true}})});
  assert.equal(practiceResponse.status,201);const {code:practiceCode}=await practiceResponse.json(),practice=await join(practiceCode,practiceToken,'暂停恢复练习');
  await practice.act({type:'buildSettlement',vertex:practice.state.state.legal.settlement[0]});
  await practice.act({type:'buildRoad',edge:practice.state.state.legal.road[0]});
  await practice.act({type:'pause'});const paused=structuredClone(practice.state);
  await stop();await start();
  const returning=await join(practiceCode,practiceToken,'暂停恢复练习');
  assert.equal(returning.state.state.room.paused,true);assert.equal(returning.state.state.me,paused.state.me);
  assert.deepEqual(returning.state.state.board,paused.state.board);assert.equal(returning.state.state.turn,paused.state.turn);
  assert.equal(returning.state.state.phase,paused.state.phase);assert.deepEqual(returning.state.state.options,paused.state.options);
  await delay(1200);assert.equal(returning.state.revision,paused.revision,'paused bot progressed after process restart');
  await returning.act({type:'resume'});const resumedRevision=returning.state.revision;
  await returning.wait(message=>message.type==='state'&&message.revision>resumedRevision);
  console.log(`Local Worker restart passed: ${count} identities, automatic profile, in-progress board/turn, private hands, plus paused ${count}-seat practice remains frozen after restart and bots continue on resume.`);
}finally{await stop();await rm(persistence,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
