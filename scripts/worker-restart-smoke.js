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
  const tokens=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
  const response=await fetch(origin+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:tokens[0],name:'本地恢复房主'})});assert.equal(response.status,201);
  const {code}=await response.json(),names=['本地恢复房主','本地恢复朋友乙','本地恢复朋友丙'];
  const players=[];for(let i=0;i<3;i++)players.push(await join(code,tokens[i],names[i]));
  const [a,b,c]=players;await a.wait(message=>message.type==='state'&&message.state.players.length===3);
  await b.act({type:'ready'});await c.wait(message=>message.type==='state'&&message.state.players[1].ready);
  await c.act({type:'ready'});await a.wait(message=>message.type==='state'&&message.state.players.slice(1).every(player=>player.ready));
  await a.act({type:'start'});
  while(a.state.state.phase.startsWith('setup')){
    const active=players[a.state.state.turn],revision=a.state.revision;
    await active.wait(message=>message.type==='state'&&message.revision===revision);
    await active.act(a.state.state.phase==='setup-settlement'?{type:'buildSettlement',vertex:active.state.state.legal.settlement[0]}:{type:'buildRoad',edge:active.state.state.legal.road[0]});
    await a.wait(message=>message.type==='state'&&message.revision>revision);
  }
  for(const player of players)await player.wait(message=>message.type==='state'&&message.state.phase==='roll');
  assert.ok(players.every(player=>Object.values(player.state.state.players.find(p=>p.id===player.state.state.me).hand).some(amount=>amount>0)));
  const before=players.map(player=>structuredClone(player.state.state));
  await stop();await start();
  for(let i=0;i<3;i++){
    const restored=(await join(code,tokens[i],names[i])).state.state;
    assert.equal(restored.me,before[i].me);assert.equal(restored.phase,before[i].phase);assert.equal(restored.turn,before[i].turn);assert.deepEqual(restored.board,before[i].board);
    const mine=restored.players.find(player=>player.id===restored.me),previous=before[i].players.find(player=>player.id===before[i].me);
    assert.deepEqual(mine.hand,previous.hand);assert.deepEqual(mine.dev,previous.dev);
    assert.ok(restored.players.filter(player=>player.id!==restored.me).every(player=>player.hand===undefined&&player.dev===undefined));assert.equal(restored.deck,undefined);
  }
  console.log('Local Worker restart passed: three identities, in-progress board/turn, private hands and persisted Durable Object state restored after process replacement.');
}finally{await stop();await rm(persistence,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
