import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,addPlayer,act,botAction,viewFor,total} from '../shared/game.js';
import {createRandomStream,randomIndex} from '../shared/random.js';
import {Room} from '../shared/room.js';
import {createRoomFromInput} from '../shared/room-create.js';
import {withStartingRolls} from './fixtures/starting-rolls.js';

const at=1_000_000, seed=Array.from({length:11},(_,i)=>i+71);
const persisted=value=>JSON.parse(JSON.stringify(value));
const rng=(value=42)=>()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};
function lobby(n) {const g=createGame({},seed);for(let i=0;i<n;i++)addPlayer(g,`p${i}`,`玩家${i}`,i>0);g.players.forEach(p=>p.ready=true);g.hostId='p0';return g;}
function step(g) {const id=g.players[g.turn].id;return act(g,id,botAction(g,id));}
function finish(g) {while(g.phase.startsWith('setup-'))g=step(g);return g;}
function restore(g) {
  const r=new Room(undefined,at);r.record.game=structuredClone(g);r.record.random=r.record.game.random;delete r.record.game.random;r.record.hostId=g.hostId;
  return new Room(JSON.parse(JSON.stringify(r.record)),at+1);
}
function send(r,id,action) {return r.handle(id,{id:crypto.randomUUID(),revision:r.record.revision,action},at+2);}
function forceWinner(r,n,first) {
  const random=createRandomStream(seed);random.counter=1;random.words=Array.from({length:16},(_,i)=>i*31);
  for(let i=0;i<n;i++)random.words[i*2]=random.words[i*2+1]=i===first?5:0;
  r.record.random=random;
}

test('every seat can start in 3/4/5/6 players; clockwise ring, reverse placement and first production stay aligned',()=>{
  for(const n of [3,4,5,6])for(let first=0;first<n;first++){
    const source=lobby(n),seats=structuredClone(source.players);
    let g=act(source,'p0',{type:'start'},withStartingRolls(n,rng(),first));
    assert.deepEqual(g.players,seats);assert.equal(g.hostId,'p0');assert.equal(g.dice,null);assert.equal(g.turn,first);assert.equal(g.primaryTurn,first);
    assert.deepEqual(g.startingPlayer,{index:first,dice:[6,6],rounds:1});
    const order=[];
    while(g.phase.startsWith('setup-')){
      if(g.phase==='setup-settlement')order.push(g.turn);
      g=step(g);
      if(g.setupIndex<n)assert.equal(g.players.reduce((sum,p)=>sum+total(p.hand),0),0);
    }
    const clockwise=Array.from({length:n},(_,i)=>(first+i)%n);
    assert.deepEqual(order,[...clockwise,...clockwise.toReversed()]);
    assert.equal(g.turn,first);assert.equal(g.primaryTurn,first);assert.equal(g.phase,'roll');assert.equal(g.turnNo,1);
    g=act(g,g.players[first].id,{type:'roll'},()=>.5);assert.equal(g.phase,'action');
    g=act(g,g.players[first].id,{type:'endTurn'});
    if(n>4){assert.equal(g.turn,(first+3)%n);assert.equal(g.pairStep,'secondary');g=act(g,g.players[g.turn].id,{type:'endTurn'});}
    assert.equal(g.turn,(first+1)%n);assert.equal(g.pairStep,'primary');assert.equal(g.phase,'roll');
  }
});

test('highest sum wins; only tied leaders roll again, including repeated ties and bots',()=>{
  // First round p1/p3 tie on 10; p0/p2 are eliminated. Only p1/p3
  // reroll twice. p3 wins with 2+6, not by the highest individual die.
  const values=[1,6,5,5,6,3,6,4, 3,4,1,6, 2,5,2,6].map(d=>(d-.5)/6),random=rng();
  const g=act(lobby(4),'p0',{type:'start'},()=>values.length?values.shift():random());
  assert.deepEqual(g.startingPlayer,{index:3,dice:[2,6],rounds:3});assert.equal(g.players[3].bot,true);
  assert.match(g.log[0].text,/玩家0 1\+6=7；玩家1 5\+5=10；玩家2 6\+3=9；玩家3 6\+4=10/);
  assert.equal(g.log[1].text,'同分加掷：玩家1 3+4=7；玩家3 1+6=7。');
  assert.equal(g.log[2].text,'同分加掷：玩家1 2+5=7；玩家3 2+6=8。');
  assert.match(g.log[3].text,/玩家3 获得先手/);
});

test('actual persisted stream determines the same dice on retry, and failed selection is atomic',()=>{
  for(const n of [3,4,5,6]){
    const source=lobby(n),before=structuredClone(source),random=structuredClone(source.random);
    let candidates=Array.from({length:n},(_,i)=>i),rounds=0,winner;
    while(candidates.length>1){rounds++;const rolls=candidates.map(index=>({index,dice:[randomIndex(6,random)+1,randomIndex(6,random)+1]}));const max=Math.max(...rolls.map(p=>p.dice[0]+p.dice[1]));const leaders=rolls.filter(p=>p.dice[0]+p.dice[1]===max);candidates=leaders.map(p=>p.index);winner=leaders[0];}
    const first=act(source,'p0',{type:'start'}),retry=act(source,'p0',{type:'start'});
    assert.deepEqual(first.startingPlayer,{...winner,rounds});assert.deepEqual(retry.startingPlayer,first.startingPlayer);
    assert.deepEqual(retry.random,first.random);assert.deepEqual(retry.board,first.board);assert.deepEqual(source,before);
    assert.throws(()=>act(source,'p0',{type:'start'},()=>.5),/重试上限/);assert.deepEqual(source,before);
  }
});

test('host transfer keeps permissions and seats independent; rematch discards old result and rerolls',()=>{
  const r=restore(lobby(4)),seats=r.record.game.players.map(p=>p.id);
  r.record.game.players[2].bot=false;send(r,'p0',{type:'transferHost',playerId:'p2'});forceWinner(r,4,1);
  assert.throws(()=>send(r,'p0',{type:'start'}),/房主/);send(r,'p2',{type:'start'});
  assert.equal(r.record.game.turn,1);assert.equal(r.record.hostId,'p2');assert.deepEqual(r.record.game.players.map(p=>p.id),seats);
  r.record.game.phase='finished';send(r,'p2',{type:'rematch'});
  assert.equal(r.record.game.startingPlayer,undefined);assert.equal(r.record.game.phase,'lobby');
  r.record.game.players.forEach(p=>p.ready=true);forceWinner(r,4,3);send(r,'p2',{type:'start'});
  assert.equal(r.record.game.turn,3);assert.deepEqual(r.record.game.players.map(p=>p.id),seats);assert.equal(r.record.hostId,'p2');
});

test('save/reconnect at every setup step preserves the winner, dice and stream without rerolling',()=>{
  for(const n of [3,4,5,6]){
    let g=act(lobby(n),'p0',{type:'start'},withStartingRolls(n,rng(),n-1));
    while(g.phase.startsWith('setup-')){
      const r=restore(g),random=structuredClone(r.record.random),restored={...r.record.game,random:r.record.random};
      assert.deepEqual(r.snapshot('p0',[],at+1).state.startingPlayer,g.startingPlayer);
      assert.deepEqual(r.record.random,random);assert.deepEqual(persisted(step(restored)),persisted(step(g)));
      g=step(g);
    }
    const r=restore(g);assert.equal(r.record.game.turn,n-1);assert.equal(r.record.game.phase,'roll');
  }
});

test('legacy mid-setup and normal saves keep seat-zero order and progress without metadata migration',()=>{
  for(const n of [3,4,5,6]){
    let g=act(lobby(n),'p0',{type:'start'},withStartingRolls(n,rng()));delete g.startingPlayer;
    while(g.phase.startsWith('setup-')){
      const before=persisted(g);delete before.random;const r=restore(g);
      assert.deepEqual(r.record.game,before);assert.equal(r.snapshot('p0',[],at+1).state.startingPlayer,undefined);
      g=step({...r.record.game,random:r.record.random});
    }
    assert.equal(g.turn,0);g.phase='action';g.turn=n-1;g.primaryTurn=n-1;
    const r=restore(g);assert.equal(r.record.game.turn,n-1);assert.equal(r.record.game.startingPlayer,undefined);
  }
});

test('practice selects among humans and bots using identical authority and publishes only rolled result',async()=>{
  for(const n of [3,4,5,6]){
    const r=await createRoomFromInput({token:crypto.randomUUID(),name:'练习',practice:true,playerCount:n},at),g=r.record.game;
    assert.equal(g.turn,g.startingPlayer.index);assert.equal(g.primaryTurn,g.turn);assert.equal(g.players.filter(p=>p.bot).length,n-1);
    assert.ok(g.log.some(entry=>entry.text.startsWith('先手掷骰：')));
    g.startingPlayer.secret='do-not-publish';g.startingPlayer.dice.push('do-not-publish');
    for(const p of g.players){const view=viewFor(g,p.id);assert.deepEqual(Object.keys(view.startingPlayer).sort(),['dice','index','rounds']);assert.equal(view.startingPlayer.dice.length,2);assert.ok(!JSON.stringify(view).includes('do-not-publish'));for(const key of ['random','key','nonce','words','offset','counter'])assert.equal(view[key],undefined);}
  }
});

test('duplicate start, stale requests and restored receipt never consume another selection',()=>{
  const r=restore(lobby(6)),request={id:'first-start',revision:r.record.revision,action:{type:'start'}};
  r.handle('p0',request,at+2);const after=structuredClone(r.record);r.handle('p0',request,at+3);assert.deepEqual(r.record,after);
  const restored=new Room(JSON.parse(JSON.stringify(after)),at+4);restored.handle('p0',request,at+5);assert.deepEqual(restored.record.game,persisted(after.game));assert.deepEqual(restored.record.random,after.random);
  assert.throws(()=>restored.handle('p0',{...request,id:'stale'},at+6),/棋盘已更新/);assert.deepEqual(restored.record.random,after.random);
});
