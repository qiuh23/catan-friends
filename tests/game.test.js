import {withStartingRolls} from './fixtures/starting-rolls.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, emptyHand, RESOURCES, neighbors, longestRoad } from '../shared/board.js';
import { createGame, addPlayer, act, viewFor, legal, points, updateAwards, tradeRatio, botAction, total } from '../shared/game.js';
import { Room, fingerprint } from '../shared/room.js';
const rng=(seed=42)=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function lobby(n=3){const g=createGame();for(let i=0;i<n;i++)addPlayer(g,`p${i}`,`玩家${i}`,true);return g;}
function setup(n=3){let g=act(lobby(n),'p0',{type:'start'},withStartingRolls(n,rng()));while(g.phase.startsWith('setup')){const id=g.players[g.turn].id;g=act(g,id,botAction(g,id));}return g;}
function actionGame(){const g=setup();g.phase='action';return g;}
function grant(g,id,hand){const p=g.players.find(p=>p.id===id);for(const r of RESOURCES){g.bank[r]+=p.hand[r];p.hand[r]=hand[r]||0;g.bank[r]-=p.hand[r];}}
function conserved(g){for(const r of RESOURCES)assert.equal(g.bank[r]+g.players.reduce((sum,p)=>sum+p.hand[r],0),19,r);}
test('random board has 19 tiles, 54 vertices, 72 edges and nine non-overlapping ports',()=>{
  for(let seed=1;seed<=60;seed++){
    const b=createBoard(rng(seed));assert.equal(b.tiles.length,19);assert.equal(b.vertices.length,54);assert.equal(b.edges.length,72);assert.equal(b.ports.length,9);
    assert.equal(new Set(b.ports.flatMap(p=>p.vertices)).size,18);
    assert.equal(b.tiles.filter(t=>t.resource==='wood').length,4);
    assert.equal(b.tiles.filter(t=>t.resource==='desert').length,1);
    for(const e of b.edges)if(e.tiles.length===2)assert.ok(!e.tiles.every(id=>[6,8].includes(b.tiles[id].number)));
  }
});
test('3 and 4 player setup follows snake order and grants only second settlement resources',()=>{
  for(const n of [3,4]){
    let g=act(lobby(n),'p0',{type:'start'},withStartingRolls(n,rng()));const turns=[];
    while(g.phase.startsWith('setup')){const id=g.players[g.turn].id;if(g.phase==='setup-settlement')turns.push(g.turn);g=act(g,id,botAction(g,id));if(g.setupIndex<n)assert.equal(g.players.reduce((sum,p)=>sum+total(p.hand),0),0);}
    assert.deepEqual(turns,[...Array(n).keys(),...Array(n).keys()].map((v,i)=>i<n?v:n-1-v));
    assert.equal(g.phase,'roll');assert.equal(g.turn,0);for(const p of g.players){assert.equal(points(g,p.id),2);assert.equal(g.board.edges.filter(e=>e.owner===p.id).length,2);}conserved(g);
  }
});
test('illegal commands are atomic and non-active players cannot build or roll',()=>{
  const g=actionGame();grant(g,'p0',emptyHand());const before=structuredClone(g);
  assert.throws(()=>act(g,'p1',{type:'roll'}),/等待/);
  assert.throws(()=>act(g,'p0',{type:'buildRoad',edge:legal(g,'p0').road[0]}),/资源不足/);
  assert.deepEqual(g,before);
  const v=g.board.vertices.find(v=>v.owner==='p0');assert.ok(neighbors(g.board,v.id).every(id=>!legal(g,'p0').settlement.includes(id)));
});
test('production pays settlements/cities, and robber blocks the affected tile',()=>{
  const g=setup(),v=g.board.vertices.find(v=>v.owner==='p0'),tile=g.board.tiles[v.tiles.find(id=>g.board.tiles[id].number)];
  g.board.vertices.forEach(v=>{v.owner=null;v.level=0;});v.owner='p0';v.level=2;
  for(const p of g.players)grant(g,p.id,emptyHand());
  g.robber=g.board.tiles.find(t=>t.resource==='desert').id;
  const d1=Math.max(1,tile.number-6),d2=tile.number-d1;let i=0;const random=()=>[(d1-1)/6+.01,(d2-1)/6+.01][i++];
  const after=act(g,'p0',{type:'roll'},random);assert.ok(after.players[0].hand[tile.resource]>=2);conserved(after);
  g.robber=tile.id;i=0;const blocked=act(g,'p0',{type:'roll'},random);
  assert.equal(after.players[0].hand[tile.resource]-blocked.players[0].hand[tile.resource],2);
});
test('seven requires all eligible players to discard, then robber steals privately',()=>{
  let g=setup();grant(g,'p0',{wood:8});grant(g,'p1',{brick:9});
  let i=0;g=act(g,'p0',{type:'roll'},()=>[.01,.99][i++]);assert.equal(g.phase,'discard');assert.deepEqual(g.discards,{p0:4,p1:4});
  assert.throws(()=>act(g,'p0',{type:'moveRobber',tile:1}),/请选择/);
  assert.throws(()=>act(g,'p1',{type:'discard',cards:{brick:3}}),/恰好/);
  g=act(g,'p1',{type:'discard',cards:{brick:4}});assert.equal(g.phase,'discard');g=act(g,'p0',{type:'discard',cards:{wood:4}});assert.equal(g.phase,'robber');
  const target=g.board.vertices.find(v=>v.owner==='p1').tiles.find(id=>id!==g.robber);g=act(g,'p0',{type:'moveRobber',tile:target});assert.equal(g.phase,'steal');
  g=act(g,'p0',{type:'steal',victim:'p1'},()=>0);assert.equal(g.players[0].hand.brick,1);assert.equal(g.phase,'action');conserved(g);
  assert.ok(!g.log.at(-1).text.includes('砖块'));
});
test('bank and specialized port ratios respect resources and finite inventory',()=>{
  let g=actionGame();grant(g,'p0',{wood:8});g.board.ports.forEach(p=>p.vertices.forEach(id=>{if(g.board.vertices[id].owner==='p0')g.board.vertices[id].owner=null;}));
  assert.equal(tradeRatio(g,'p0','wood'),4);const before=g.players[0].hand.wheat;g=act(g,'p0',{type:'bankTrade',give:'wood',want:'wheat'});assert.equal(g.players[0].hand.wood,4);assert.equal(g.players[0].hand.wheat,before+1);conserved(g);
  const port=g.board.ports.find(p=>p.resource==='wood');g.board.vertices[port.vertices[0]].owner='p0';assert.equal(tradeRatio(g,'p0','wood'),2);
  g.bank.wheat=0;assert.throws(()=>act(g,'p0',{type:'bankTrade',give:'wood',want:'wheat'}),/不足/);
  assert.throws(()=>act(g,'p0',{type:'bankTrade',give:'wood',want:'wood'}),/不同/);
});
test('player trades are atomic, only active player offers, stale offers cannot be accepted',()=>{
  let g=actionGame();grant(g,'p0',{wood:3});grant(g,'p1',{ore:2});
  assert.throws(()=>act(g,'p1',{type:'offerTrade',give:{ore:1},want:{wood:1}}),/等待/);
  g=act(g,'p0',{type:'offerTrade',give:{wood:2},want:{ore:1}});const offerId=g.offer.id;
  assert.throws(()=>act(g,'p2',{type:'acceptTrade',offerId}),/资源不足/);
  g=act(g,'p1',{type:'acceptTrade',offerId});assert.equal(g.players[0].hand.ore,1);assert.equal(g.players[1].hand.wood,2);assert.equal(g.offer,null);conserved(g);
  assert.throws(()=>act(g,'p1',{type:'acceptTrade',offerId}),/失效/);
});
test('negative, fractional and unknown resource quantities are rejected',()=>{
  const g=actionGame();grant(g,'p0',{wood:5});
  for(const give of [{wood:-1},{wood:1.2},{gold:1},{wood:20}])assert.throws(()=>act(g,'p0',{type:'offerTrade',give,want:{ore:1}}));
});
test('private views never reveal another hand, development cards, or deck order',()=>{
  const g=actionGame();g.players[1].dev.push({id:'secret-card',type:'victory',bought:0});const view=viewFor(g,'p0');
  assert.equal(view.players[1].hand,undefined);assert.equal(view.players[1].dev,undefined);assert.equal(view.deck,undefined);assert.equal(view.players[1].points,2);assert.equal(view.players[1].developmentCount,1);assert.ok(!JSON.stringify(view).includes('secret-card'));
});
test('development deck composition, new-card delay, and one card per turn',()=>{
  let g=actionGame();assert.equal(g.deck.length,25);assert.equal(g.deck.filter(c=>c==='knight').length,14);grant(g,'p0',{wheat:3,sheep:3,ore:3});g.deck=['knight'];
  g=act(g,'p0',{type:'buyDevelopment'});const card=g.players[0].dev[0];assert.throws(()=>act(g,'p0',{type:'playDevelopment',cardId:card.id}),/之前回合/);
  g.turnNo++;g.phase='roll';g=act(g,'p0',{type:'playDevelopment',cardId:card.id});assert.equal(g.phase,'robber');assert.equal(g.resumePhase,'roll');assert.equal(g.players[0].knights,1);
  const tile=g.board.tiles.find(t=>t.id!==g.robber&&t.vertices.every(v=>g.board.vertices[v].owner===null));
  g=act(g,'p0',{type:'moveRobber',tile:tile.id});assert.equal(g.phase,'roll');
  g.players[0].dev.push({id:'next',type:'monopoly',bought:0});assert.throws(()=>act(g,'p0',{type:'playDevelopment',cardId:'next',resource:'wood'}),/每回合/);
});
test('plenty, monopoly and free roads execute without resource leakage',()=>{
  let g=actionGame();g.players[0].dev.push({id:'plenty',type:'plenty',bought:0});const before=g.players[0].hand.ore;g=act(g,'p0',{type:'playDevelopment',cardId:'plenty',cards:{ore:2}});assert.equal(g.players[0].hand.ore,before+2);conserved(g);
  g.playedDev=false;g.players[0].dev.push({id:'mono',type:'monopoly',bought:0});const all=g.players.reduce((s,p)=>s+p.hand.wheat,0);g=act(g,'p0',{type:'playDevelopment',cardId:'mono',resource:'wheat'});assert.equal(g.players[0].hand.wheat,all);conserved(g);
  g.playedDev=false;g.players[0].dev.push({id:'roads',type:'roadBuilding',bought:0});const hand={...g.players[0].hand};g=act(g,'p0',{type:'playDevelopment',cardId:'roads'});
  for(let i=0;i<2;i++)g=act(g,'p0',{type:'buildRoad',edge:legal(g,'p0').road[0]});assert.equal(g.phase,'action');assert.deepEqual(g.players[0].hand,hand);
});
function chain(g,id,count){
  const walk=(v,path,seen)=>{if(path.length===count)return path;for(const eid of g.board.vertices[v].edges){const e=g.board.edges[eid],next=e.a===v?e.b:e.a;if(seen.has(next)||e.owner)continue;const found=walk(next,[...path,eid],new Set([...seen,next]));if(found)return found;}return null;};
  for(const v of g.board.vertices){const path=walk(v.id,[],new Set([v.id]));if(path){path.forEach(e=>g.board.edges[e].owner=id);return path;}}
}
test('longest road counts continuous edges; opponent settlements cut the road',()=>{
  const g=actionGame();g.board.edges.forEach(e=>e.owner=null);g.board.vertices.forEach(v=>v.owner=null);const path=chain(g,'p0',6);assert.equal(longestRoad(g.board,'p0'),6);updateAwards(g);assert.equal(g.longest,'p0');
  const a=g.board.edges[path[2]],b=g.board.edges[path[3]],shared=[a.a,a.b].find(v=>[b.a,b.b].includes(v));g.board.vertices[shared].owner='p1';g.board.vertices[shared].level=1;assert.equal(longestRoad(g.board,'p0'),3);updateAwards(g);assert.equal(g.longest,null);
});
test('largest army ties retain owner, stronger army transfers it',()=>{
  const g=actionGame();g.players[0].knights=3;updateAwards(g);assert.equal(g.army,'p0');g.players[1].knights=3;updateAwards(g);assert.equal(g.army,'p0');g.players[1].knights=4;updateAwards(g);assert.equal(g.army,'p1');
});
test('hidden VP cards win only on their owner’s turn, including newly purchased VP',()=>{
  let g=actionGame();g.players[0].dev=Array.from({length:7},(_,i)=>({id:String(i),type:'victory',bought:0}));g.deck=['victory'];grant(g,'p0',{sheep:1,wheat:1,ore:1});g=act(g,'p0',{type:'buyDevelopment'});assert.equal(g.phase,'finished');assert.equal(g.winner,'p0');assert.equal(points(g,'p0'),10);
  g=actionGame();g.players[1].dev=Array.from({length:8},(_,i)=>({id:String(i),type:'victory',bought:0}));g=act(g,'p0',{type:'endTurn'});assert.equal(g.winner,'p1');
});
test('room identities reconnect, commands deduplicate before version check, stale writes fail',async()=>{
  const room=new Room(),hash=await fingerprint(crypto.randomUUID()),id=room.join(hash,'作者');assert.equal(room.join(hash,'另一个昵称'),id);assert.equal(room.record.game.players.length,1);
  const msg={id:'same-action',revision:room.record.revision,action:{type:'addBot'}};room.handle(id,msg);const revision=room.record.revision;room.handle(id,msg);assert.equal(room.record.game.players.length,2);assert.equal(room.record.revision,revision);
  assert.throws(()=>room.handle(id,{...msg,id:'different-action'}),/更新/);assert.ok(!JSON.stringify(room.snapshot(id)).includes(hash));
});
test('bots can accept an affordable fair player trade during the human turn',()=>{
  const g=actionGame();g.players[0].bot=false;grant(g,'p0',{wood:2});grant(g,'p1',{ore:1});
  const offered=act(g,'p0',{type:'offerTrade',give:{wood:1},want:{ore:1}}),room=new Room();room.record.game=offered;
  assert.equal(room.nextBot().actor,'p1');assert.equal(room.nextBot().action.type,'acceptTrade');room.tick();assert.equal(room.record.game.players[0].hand.ore,1);assert.equal(room.record.game.turn,0);conserved(room.record.game);
});
test('bots can finish full games using legal moves and conserve every resource',()=>{
  for(let seed=1;seed<=5;seed++){
    const random=rng(seed);let g=act(lobby(),'p0',{type:'start'},random),steps=0;
    while(g.phase!=='finished'&&steps++<12000){const p=g.phase==='discard'?g.players.find(p=>g.discards[p.id]):g.players[g.turn];const action=botAction(g,p.id);assert.ok(action,`no bot action ${g.phase}`);g=act(g,p.id,action,random);conserved(g);}
    assert.equal(g.phase,'finished',`seed ${seed}: ${steps} actions, scores ${g.players.map(p=>points(g,p.id))}`);
  }
});
