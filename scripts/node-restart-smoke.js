// Local child process only; no production services or persistent user rooms.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {WebSocket} from 'ws';
import {RuntimeClient} from '../tests/runtime-client.js';
import {act} from '../shared/game.js';
const directory=await mkdtemp(path.join(os.tmpdir(),'catan-node-restart-')),port=Number(process.env.LOCAL_NODE_RESTART_PORT)||8797,origin=`http://127.0.0.1:${port}`;
let child,clients=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(){
  child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:directory},stdio:['ignore','pipe','pipe'],windowsHide:true});
  // Keep process output out of assertions; authority logs never contain state.
  child.stdout.resume();child.stderr.resume();
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Local Node child stopped.');try{const response=await fetch(origin+'/api/health');if(response.ok)return;}catch{}await pause(100);}
  throw Error('Local Node child did not start.');
}
async function stop(){
  for(const client of clients)client.ws.terminate();clients=[];
  if(!child||child.exitCode!==null)return;
  if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGKILL');
  if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));child=null;
}
async function join(code,token){const client=new RuntimeClient(new WebSocket(origin+`/api/rooms/${code}/ws`));clients.push(client);client.ws.addEventListener('open',()=>client.ws.send(JSON.stringify({type:'hello',token,name:'本地重启测试'})));await client.wait(message=>message.type==='state');return client;}
try{
  await start();const tokens=Array.from({length:3},()=>crypto.randomUUID());
  const created=await fetch(origin+'/api/rooms',{method:'POST',body:JSON.stringify({token:tokens[0],name:'本地重启房主'})}),{code}=await created.json(),players=[];
  for(const token of tokens)players.push(await join(code,token));const [a]=players;
  for(let i=1;i<3;i++){await players[i].act({type:'ready',ready:true});await a.wait(state=>state.type==='state'&&state.state.players[i]?.ready);}
  await a.act({type:'start'});
  while(a.state.state.phase.startsWith('setup')){
    const view=a.state.state,active=players.find(player=>player.state.state.me===view.players[view.turn].id),revision=a.state.revision;
    await active.wait(message=>message.type==='state'&&message.revision===revision);
    await active.act(view.phase==='setup-settlement'?{type:'buildSettlement',vertex:active.state.state.legal.settlement[0]}:{type:'buildRoad',edge:active.state.state.legal.road[0]});
    await a.wait(message=>message.type==='state'&&message.revision>revision);
  }
  const file=path.join(directory,code+'.json'),before=JSON.parse(await readFile(file,'utf8')),expected=act({...before.game,random:before.random},before.hostId,{type:'roll'});
  await stop();await start();const recovered=await join(code,tokens[0]),restored=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(restored.random,before.random);assert.deepEqual(restored.game.deck,before.game.deck);assert.deepEqual(restored.game.board,before.game.board);assert.deepEqual(restored.game.players,before.game.players);
  const envelope=await recovered.act({type:'roll'}),after=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(after.game.dice,expected.dice);assert.deepEqual(after.random,expected.random);
  await recovered.act(envelope.action,envelope);const duplicate=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(duplicate.random,after.random);
  for(const message of recovered.messages)for(const field of ['"random"','"nonce"','"key"','"words"'])assert.ok(!JSON.stringify(message).includes(field));
  console.log('Local Node hard restart passed: saved identity, map/deck/private hands/stream, next deterministic roll, exact duplicate receipt and secret-free snapshots.');
}finally{await stop();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
