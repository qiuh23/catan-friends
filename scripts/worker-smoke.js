import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
const origin=process.env.TEST_URL||'http://127.0.0.1:8788';
const sockets=[];
async function connect(code,token,name){
  const ws=new WebSocket(`${origin.replace('http','ws')}/api/rooms/${code}/ws`),client={ws,messages:[],state:null};sockets.push(ws);
  ws.on('open',()=>ws.send(JSON.stringify({type:'hello',token,name})));ws.on('message',raw=>{const m=JSON.parse(raw);client.messages.push(m);if(m.type==='state')client.state=m;});
  client.wait=async(predicate,after=0)=>{for(let i=0;i<250;i++){const m=client.messages.slice(after).find(predicate);if(m)return m;await new Promise(r=>setTimeout(r,20));}throw new Error('Worker message timeout');};
  client.act=async action=>{const id=crypto.randomUUID(),after=client.messages.length;ws.send(JSON.stringify({type:'action',id,revision:client.state.revision,action}));const reply=await client.wait(m=>m.id===id,after);assert.equal(reply.type,'ack',JSON.stringify(reply));await client.wait(m=>m.type==='state',after);};
  await client.wait(m=>m.type==='state');return client;
}
try{
  const token=crypto.randomUUID(),response=await fetch(`${origin}/api/rooms`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,name:'Worker房主'})});assert.equal(response.status,201);const {code}=await response.json();
  const a=await connect(code,token,'Worker房主'),b=await connect(code,crypto.randomUUID(),'Worker朋友');await a.wait(m=>m.type==='state'&&m.state.players.length===2);
  await a.act({type:'addBot'});await b.wait(m=>m.type==='state'&&m.state.players.length===3);await b.act({type:'ready'});await a.wait(m=>m.type==='state'&&m.state.players[1]?.ready);
  await a.act({type:'start'});const first=a.state.state.startingPlayer.index;
  while(a.state.state.phase.startsWith('setup-')){
    const view=a.state.state,revision=a.state.revision,active=[a,b].find(client=>client.state.state.me===view.players[view.turn].id);
    if(active){await active.wait(m=>m.type==='state'&&m.revision===revision);await active.act(view.phase==='setup-settlement'?{type:'buildSettlement',vertex:active.state.state.legal.settlement[0]}:{type:'buildRoad',edge:active.state.state.legal.road[0]});}
    await a.wait(m=>m.type==='state'&&m.revision>revision);
  }
  await b.wait(m=>m.type==='state'&&m.state.phase==='roll');assert.equal(b.state.state.players[0].hand,undefined);assert.equal(b.state.state.deck,undefined);
  assert.equal(b.state.state.turn,first);assert.equal(b.state.state.board.edges.filter(e=>e.owner===b.state.state.players[2].id).length,2);
  const me=a.state.state.me;a.ws.close();const restored=await connect(code,token,'Worker房主');assert.equal(restored.state.state.me,me);assert.equal(restored.state.state.players.length,3);
  console.log('Worker smoke passed: create/join, authority, personalized views, bot alarms and refresh recovery.');
}finally{for(const ws of sockets)ws.terminate();}
