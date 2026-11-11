import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../scripts/map-first-fixture.js';
import {act,viewFor,tradeRatio,updateAwards,points,COSTS} from '../shared/game.js';
import {longestRoad,emptyHand} from '../shared/board.js';
import {Room} from '../shared/room.js';
import {portGeometry,portOwners} from '../src/ports.js';
import {buildAvailability,tradeRestriction,normalizeTradeDraft} from '../src/commerce.js';

test('every rendered port uses the exact coast edge and both endpoints in both map editions',()=>{
  for(const n of [4,6]){
    const g=fixture(n);
    for(const port of g.board.ports){
      const edge=g.board.edges[port.edge],geo=portGeometry(g.board,port);
      assert.equal(edge.tiles.length,1);assert.deepEqual(port.vertices,[edge.a,edge.b]);
      assert.deepEqual(geo.arms.map(a=>a.vertex),port.vertices);
      const tile=g.board.tiles[edge.tiles[0]];
      assert.ok((geo.label.x-geo.midpoint.x)*(geo.midpoint.x-tile.x)+(geo.label.z-geo.midpoint.z)*(geo.midpoint.z-tile.z)>0);
    }
  }
});
test('best 4:1, 3:1, 2:1 is shared, endpoint buildings unlock for both owners; roads and robber do not',()=>{
  const g=fixture(4);g.board.vertices.forEach(v=>{v.owner=null;v.level=0;});
  assert.equal(tradeRatio(g,'p0','wood'),4);
  const generic=g.board.ports.find(p=>p.resource==='any'),specific=g.board.ports.find(p=>p.resource==='wood');
  g.board.edges[generic.edge].owner='p0';assert.equal(tradeRatio(g,'p0','wood'),4);
  Object.assign(g.board.vertices[generic.vertices[0]],{owner:'p0',level:1});assert.equal(tradeRatio(g,'p0','ore'),3);
  Object.assign(g.board.vertices[specific.vertices[0]],{owner:'p0',level:1});
  Object.assign(g.board.vertices[specific.vertices[1]],{owner:'p1',level:2});
  assert.deepEqual(portOwners(g.board,specific),['p0','p1']);
  g.robber=g.board.edges[specific.edge].tiles[0];
  assert.equal(tradeRatio(g,'p0','wood'),2);assert.equal(tradeRatio(g,'p1','wood'),2);
  for(const id of ['p0','p1']){
    const v=viewFor(g,id);assert.equal(tradeRatio(v,id,'wood'),2,'the personal projection preserves the unlocked specialized rate');
  }
});
test('bank exchange is one atomic transaction and rejects shortages, identical resources and bad phases',()=>{
  for(const ratio of [4,3,2]){
    let g=fixture(4);g.board.vertices.forEach(v=>{v.owner=null;v.level=0;});
    if(ratio<4){const port=g.board.ports.find(p=>p.resource===(ratio===3?'any':'wood'));Object.assign(g.board.vertices[port.vertices[1]],{owner:'p0',level:1});}
    g.players[0].hand.wood=ratio;g.bank.ore=1;
    const after=act(g,'p0',{type:'bankTrade',give:'wood',want:'ore'});
    assert.equal(after.players[0].hand.wood,0);assert.equal(after.bank.ore,0);assert.equal(after.players[0].hand.ore,g.players[0].hand.ore+1);
    for(const change of [g=>g.bank.ore=0,g=>g.players[0].hand.wood=ratio-1,g=>g.phase='roll']){
      const bad=structuredClone(g);change(bad);const before=structuredClone(bad);assert.throws(()=>act(bad,'p0',{type:'bankTrade',give:'wood',want:'ore'}));assert.deepEqual(bad,before);
    }
    assert.throws(()=>act(g,'p0',{type:'bankTrade',give:'wood',want:'wood'}));
  }
});
test('public offer lifecycle: replacement, withdrawal, spent resources, turn changes and private snapshots',()=>{
  let g=fixture(4),action={type:'offerTrade',give:{wood:1},want:{ore:1}};
  g=act(g,'p0',action);const old=g.offer.id;g=act(g,'p0',action);assert.notEqual(g.offer.id,old);
  assert.throws(()=>act(g,'p1',{type:'acceptTrade',offerId:old}),/失效/);
  const id=g.offer.id;const spent=structuredClone(g);spent.players[0].hand.wood=0;
  assert.throws(()=>act(spent,'p1',{type:'acceptTrade',offerId:id}),/资源不足/);
  const cancelled=act(g,'p0',{type:'cancelTrade'});assert.equal(cancelled.offer,null);assert.throws(()=>act(cancelled,'p1',{type:'acceptTrade',offerId:id}));
  const ended=act(g,'p0',{type:'endTurn'});assert.equal(ended.offer,null);
  assert.throws(()=>act(ended,'p1',{type:'acceptTrade',offerId:id}));
  const s=viewFor(g,'p1');assert.ok(s.players.filter(p=>p.id!=='p1').every(p=>!p.hand&&!p.dev));
  assert.equal(tradeRestriction(s,true),'','another player may accept during the offer owner’s turn');
  assert.throws(()=>act(g,'p0',{type:'acceptTrade',offerId:id}),/失效/,'the owner cannot accept their own offer');
  assert.equal(s.offer.give.wood,1);assert.equal(s.offer.want.ore,1);
  const accepted=act(g,'p1',{type:'acceptTrade',offerId:id});
  assert.equal(accepted.players[1].hand.ore,g.players[1].hand.ore-1,'the acceptor pays the requested ore');
  assert.equal(accepted.players[1].hand.wood,g.players[1].hand.wood+1,'the acceptor receives the offered wood');
  assert.equal(accepted.players[0].hand.wood,g.players[0].hand.wood-1);
  assert.equal(accepted.players[0].hand.ore,g.players[0].hand.ore+1);assert.equal(accepted.offer,null);
  const secondary=fixture(6);secondary.pairStep='secondary';assert.match(tradeRestriction(viewFor(secondary,'p0'),true),/银行/);assert.throws(()=>act(secondary,'p0',action));
  assert.doesNotThrow(()=>act(secondary,'p0',{type:'bankTrade',give:'wood',want:'ore'}));
});
test('resource changes clamp drafts to current hand without blocking an unowned requested resource',()=>{
  const s=viewFor(fixture(4),'p0'),draft=new Map([['give-wood','7'],['want-wood','2'],['want-ore','24']]);
  s.players[0].hand.wood=0;normalizeTradeDraft(s,draft);
  assert.equal(draft.get('give-wood'),'0');assert.equal(draft.get('want-wood'),'2');assert.equal(draft.get('want-ore'),'19');
  draft.set('give-brick','1');draft.set('want-brick','1');normalizeTradeDraft(s,draft);assert.equal(draft.get('want-brick'),'0');
});
test('two acceptors at one revision settle only once; receipt retry and restored room do not repeat settlement',async()=>{
  const room=new Room();room.record.game=act(fixture(4),'p0',{type:'offerTrade',give:{wood:1},want:{ore:1}});
  const offerId=room.record.game.offer.id,revision=room.record.revision;
  const messages=['p1','p2'].map((actor,i)=>({actor,message:{id:`accept-${i}`,revision,action:{type:'acceptTrade',offerId}}}));
  const results=await Promise.allSettled(messages.map(({actor,message})=>Promise.resolve().then(()=>room.handle(actor,message))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(room.record.game.offer,null);
  const restored=new Room(structuredClone(room.record)),before=structuredClone(restored.record);
  restored.handle('p1',messages[0].message);assert.deepEqual(restored.record,before);
  assert.throws(()=>restored.handle('p2',{...messages[1].message,revision:restored.record.revision}),/失效/);
});
function graph(pairs){const vertices=Array.from({length:Math.max(...pairs.flat())+1},(_,id)=>({id,edges:[],owner:null,level:0}));const edges=pairs.map(([a,b],id)=>{vertices[a].edges.push(id);vertices[b].edges.push(id);return {id,a,b,owner:'p0'};});return {vertices,edges,ports:[]};}
test('longest path handles branches, closed loops, no edge reuse and opponent cuts',()=>{
  assert.equal(longestRoad(graph([[0,1],[1,2],[2,3],[1,4],[4,5]]),'p0'),4);
  const ring=graph([[0,1],[1,2],[2,3],[3,4],[4,5],[5,0]]);assert.equal(longestRoad(ring,'p0'),6);
  ring.vertices[2].owner='p1';assert.equal(longestRoad(ring,'p0'),6);
  const line=graph([[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]]);line.vertices[3].owner='p1';assert.equal(longestRoad(line,'p0'),3);
});
test('longest road retains a tied holder, transfers to a longer path, and releases a cut award without double scoring',()=>{
  const g=fixture(4),board=graph([[0,1],[1,2],[2,3],[3,4],[4,5],[6,7],[7,8],[8,9],[9,10],[10,11],[11,12]]);
  board.edges.slice(5).forEach(e=>e.owner='p1');board.edges.at(-1).owner=null;g.board=board;
  updateAwards(g);assert.equal(g.longest,null);
  g.longest='p0';updateAwards(g);assert.equal(g.longest,'p0');assert.equal(points(g,'p0',false),2);
  board.edges.at(-1).owner='p1';updateAwards(g);assert.equal(g.longest,'p1');assert.equal(points(g,'p0',false),0);assert.equal(points(g,'p1',false),2);
  board.vertices[9].owner='p2';updateAwards(g);assert.equal(g.longest,'p0');assert.equal(points(g,'p0',false),2);assert.equal(points(g,'p1',false),0);
  const n=g.presentation.sequence;updateAwards(g);assert.equal(g.presentation.sequence,n);
});
test('award ties, reassignment, public scores and optional harbor points stay consistent',()=>{
  let g=fixture(4);g.board.vertices.forEach(v=>{v.owner=null;v.level=0;});g.board.edges.forEach(e=>e.owner=null);
  g.players[0].dev=[{type:'knight'},{type:'knight'},{type:'victory'}];g.players[0].knights=2;g.players[1].knights=3;
  updateAwards(g);assert.equal(g.army,'p1');assert.equal(points(g,'p1',false),2);assert.equal(points(g,'p0',false),0);
  g.players[0].knights=3;updateAwards(g);assert.equal(g.army,'p1');
  g.players[0].knights=4;updateAwards(g);assert.equal(g.army,'p0');assert.equal(points(g,'p0',false),2);assert.equal(points(g,'p1',false),0);
  assert.match(g.presentation.events.at(-1).text,/奖项转移/);const seq=g.presentation.sequence;updateAwards(g);assert.equal(g.presentation.sequence,seq);
  const sites=g.board.ports.slice(0,3).map(p=>p.vertices[0]);for(const id of sites)Object.assign(g.board.vertices[id],{owner:'p0',level:1});
  updateAwards(g);assert.equal(g.harbormaster,null);
  g.options.harbormaster=true;updateAwards(g);assert.equal(g.harbormaster,'p0');assert.equal(points(g,'p0',false),7);
  g.phase='action';g.players[0].dev.push(...Array.from({length:4},()=>({type:'victory'})));g=act(g,'p0',{type:'bankTrade',give:'wood',want:'ore'});
  assert.equal(g.phase,'finished');assert.equal(g.winner,'p0');
});
test('costs use shared rules and distinguish free placement, stock, phase, position and affordability',()=>{
  const g=fixture(4);let s=viewFor(g,'p0');
  assert.deepEqual(buildAvailability(s,'development').cost,COSTS.development);
  s.players[0].hand=emptyHand();assert.equal(buildAvailability(s,'development').reason,'资源不足');
  s.deckCount=0;assert.equal(buildAvailability(s,'development').reason,'发展卡已售罄');
  s.phase='roll';assert.equal(buildAvailability(s,'road').reason,'当前不是行动阶段');
  for(const phase of ['setup-road','road-building']){s.phase=phase;const info=buildAvailability(s,'road');assert.equal(info.free,true);assert.deepEqual(info.cost,{});}
  s.phase='setup-settlement';assert.equal(buildAvailability(s,'settlement').free,true);
  s.phase='action';s.legal.road=[];assert.equal(buildAvailability(s,'road').reason,'没有合法建造位置');
  s.board.edges.slice(0,15).forEach(e=>e.owner='p0');assert.equal(buildAvailability(s,'road').reason,'该类棋子已用完');
});
test('partial bank payout highlights paid tiles only and robber blocks matching harvests',()=>{
  let g=fixture(4);g.phase='roll';g.board.vertices.forEach(v=>{v.owner=null;v.level=0;});
  const tiles=g.board.tiles.filter(t=>t.resource==='wood').slice(0,2);
  g.board.tiles.forEach(t=>{t.number=2;});
  for(const t of tiles){t.number=8;Object.assign(g.board.vertices[t.vertices[0]],{owner:'p0',level:2});}
  g.bank.wood=1;const before=g.players[0].hand.wood;
  g=act(g,'p0',{type:'roll'},()=>.51);assert.equal(g.players[0].hand.wood,before+1);
  assert.equal(g.presentation.events.at(-1).targets.length,1);
  g.phase='roll';g.robber=tiles[0].id;g.bank.wood=0;
  g=act(g,'p0',{type:'roll'},()=>.51);assert.equal(g.presentation.events.at(-1).kind,'blocked');assert.deepEqual(g.presentation.events.at(-1).targets,[{kind:'tile',id:tiles[0].id}]);
});
