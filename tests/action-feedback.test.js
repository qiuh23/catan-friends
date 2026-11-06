import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,addPlayer,act,botAction,legal,viewFor} from '../shared/game.js';
import {emptyHand,RESOURCES} from '../shared/board.js';
import {Room} from '../shared/room.js';
import {ActionFeedbackCursor,mergeFeedbackEvents} from '../src/action-feedback.js';

const rng=(seed=42)=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function start(){let g=createGame();for(let i=0;i<3;i++)addPlayer(g,`p${i}`,`玩家${i}`,true);return act(g,'p0',{type:'start'},rng());}
function setup(){let g=start();while(g.phase.startsWith('setup')){const id=g.players[g.turn].id;g=act(g,id,botAction(g,id));}return g;}
function grant(g,id,hand){const p=g.players.find(p=>p.id===id);for(const r of RESOURCES){g.bank[r]+=p.hand[r];p.hand[r]=hand[r]||0;g.bank[r]-=p.hand[r];}}
function roll(g,sum){let i=0;const a=Math.max(1,sum-6),b=sum-a;return act(g,g.players[g.turn].id,{type:'roll'},()=>[(a-1)/6+.01,(b-1)/6+.01][i++]);}
const head=g=>g.presentation.events.at(-1);

test('public build events record authoritative locations and reject illegal commands atomically',()=>{
  let g=start();const epoch=g.presentation.epoch;
  assert.ok(epoch);assert.equal(g.presentation.sequence,0);
  const vertex=legal(g,'p0').settlement[0];g=act(g,'p0',{type:'buildSettlement',vertex});
  assert.deepEqual(head(g),{id:1,kind:'settlement',actorId:'p0',text:'玩家0 建造了一座村庄。',targets:[{kind:'vertex',id:vertex}]});
  const before=structuredClone(g);assert.throws(()=>act(g,'p0',{type:'buildRoad',edge:-1}));assert.deepEqual(g,before);
  const edge=legal(g,'p0').road[0];g=act(g,'p0',{type:'buildRoad',edge});
  assert.equal(head(g).kind,'road');assert.deepEqual(head(g).targets,[{kind:'edge',id:edge}]);assert.equal(g.presentation.epoch,epoch);
  g=setup();g.phase='action';grant(g,'p0',{wheat:2,ore:3});const city=legal(g,'p0').city[0];g=act(g,'p0',{type:'buildCity',vertex:city});
  assert.equal(head(g).kind,'city');assert.deepEqual(head(g).targets,[{kind:'vertex',id:city}]);
});

test('simultaneous production is one public summary with all paid tiles and no private bundles',()=>{
  let g=setup();g.board.vertices.forEach(v=>{v.owner=null;v.level=0;});
  for(const p of g.players)grant(g,p.id,emptyHand());
  const tiles=g.board.tiles.filter(t=>t.resource!=='desert');
  const a=tiles[0],b=tiles.find(t=>!t.vertices.some(id=>a.vertices.includes(id)));a.number=b.number=8;
  for(const tile of tiles.filter(t=>![a.id,b.id].includes(t.id)))tile.number=2;
  Object.assign(g.board.vertices[a.vertices[0]],{owner:'p0',level:1});Object.assign(g.board.vertices[b.vertices[0]],{owner:'p1',level:2});
  const before=g.presentation.sequence;g=roll(g,8);const event=head(g);
  assert.equal(g.presentation.sequence,before+1);assert.equal(event.kind,'production');
  assert.deepEqual(event.targets,[a,b].map(t=>({kind:'tile',id:t.id})));assert.match(event.text,/玩家0、玩家1 收获，2 处地块产出/);
  assert.deepEqual(Object.keys(event).sort(),['actorId','id','kind','targets','text']);
  assert.ok(!JSON.stringify(event).includes('hand'));assert.ok(!JSON.stringify(event).includes('wheat'));
});

test('robber and exhausted-bank tiles do not receive production highlights',()=>{
  let g=setup();const tile=g.board.tiles.find(t=>t.resource!=='desert');
  for(const t of g.board.tiles)if(t.number)t.number=t.id===tile.id?8:2;
  g.board.vertices.forEach(v=>{v.owner=null;v.level=0;});
  Object.assign(g.board.vertices[tile.vertices[0]],{owner:'p0',level:1});
  g.robber=tile.id;let after=roll(g,8);assert.equal(head(after).kind,'roll');assert.deepEqual(head(after).targets,[]);
  g.robber=g.board.tiles.find(t=>t.resource==='desert').id;g.bank[tile.resource]=0;after=roll(g,8);
  assert.equal(head(after).kind,'roll');assert.deepEqual(head(after).targets,[]);
});

test('robber, theft, hidden development purchases and trade details stay public-only',()=>{
  let g=setup();g.phase='robber';g.resumePhase='action';grant(g,'p1',{ore:3});
  const tile=g.board.vertices.find(v=>v.owner==='p1').tiles.find(id=>id!==g.robber);g=act(g,'p0',{type:'moveRobber',tile});
  assert.equal(head(g).kind,'robber');assert.deepEqual(head(g).targets,[{kind:'tile',id:tile}]);
  g=act(g,'p0',{type:'steal',victim:'p1'},()=>0);assert.equal(head(g).kind,'steal');assert.ok(!JSON.stringify(head(g)).includes('ore'));
  grant(g,'p0',{wheat:1,sheep:1,ore:1});g.deck=['victory'];g=act(g,'p0',{type:'buyDevelopment'});
  assert.equal(head(g).kind,'development');assert.ok(!JSON.stringify(head(g)).includes('victory'));assert.equal(head(g).targets.length,0);
  grant(g,'p0',{wood:2});grant(g,'p1',{ore:1});g=act(g,'p0',{type:'offerTrade',give:{wood:1},want:{ore:1}});
  const before=g.presentation.sequence;g=act(g,'p1',{type:'acceptTrade',offerId:g.offer.id});
  assert.equal(g.presentation.sequence,before+1);assert.equal(head(g).kind,'trade');assert.ok(!JSON.stringify(head(g)).includes('wood'));
  const event=head(g);event.secret='hidden-card-id';event.targets.push({kind:'tile',id:tile,secret:'hidden-offer'});g.presentation.secret='private';
  const v=viewFor(g,'p2');assert.ok(!JSON.stringify(v.presentation).includes('hidden'));assert.equal(v.presentation.secret,undefined);
  assert.deepEqual(v.presentation,viewFor(g,'p0').presentation);
});

test('legacy game migration and fresh game streams retain independent stable identities',()=>{
  let g=setup();delete g.presentation;g.phase='action';grant(g,'p0',{wood:1,brick:1});
  g=act(g,'p0',{type:'buildRoad',edge:legal(g,'p0').road[0]});assert.equal(head(g).id,1);assert.ok(g.presentation.epoch);
  assert.notEqual(g.presentation.epoch,start().presentation.epoch);
  const snapshot=viewFor(g,'p0');assert.equal(snapshot.presentation.epoch,g.presentation.epoch);
});

function fake(sequence,events,epoch='match'){return {board:{edges:[{id:0},{id:1}],vertices:[{id:0},{id:1}],tiles:[{id:0},{id:1}]},players:[{id:'a'},{id:'b'}],presentation:{epoch,sequence,events}};}
const event=(id,actorId='a',kind='road',target=id%2)=>({id,actorId,kind,text:`${actorId} 行动 ${id}`,targets:[{kind:kind==='road'?'edge':'tile',id:target}]});

test('cursor hydrates refresh/reconnect/room change/rematch and never replays old snapshots',()=>{
  const cursor=new ActionFeedbackCursor(),one=fake(1,[event(1)]),two=fake(2,[event(1),event(2)]);
  assert.deepEqual(cursor.consume(one),[]);assert.deepEqual(cursor.consume(two).map(e=>e.id),[2]);
  assert.deepEqual(cursor.consume(two),[]);assert.deepEqual(cursor.consume(one),[]);assert.deepEqual(cursor.consume(two),[]);
  cursor.consume(two,{connected:false});assert.deepEqual(cursor.consume(fake(4,[event(1),event(2),event(3),event(4)])),[]);
  assert.deepEqual(cursor.consume(fake(5,[event(5)])).map(e=>e.id),[5]);
  assert.deepEqual(cursor.consume(fake(6,[event(6)]),{roomKey:'another'}),[]);
  assert.deepEqual(cursor.consume(fake(1,[event(1)],'rematch'),{roomKey:'another'}),[]);
  assert.deepEqual(new ActionFeedbackCursor().consume(fake(6,[event(6)])),[]);
});

test('cursor orders, deduplicates, skips unknown/private metadata and catches up without replaying truncated history',()=>{
  const cursor=new ActionFeedbackCursor();cursor.consume(fake(0,[]));
  const e2=event(2,'b','production');e2.secret='private';e2.targets.push({kind:'tile',id:99},{kind:'hand',id:0});
  const output=cursor.consume(fake(3,[e2,event(1),e2,{...event(3),kind:'private-card'}]));
  assert.deepEqual(output.map(e=>e.id),[1,2]);assert.equal(output[1].secret,undefined);assert.deepEqual(output[1].targets,[{kind:'tile',id:0}]);
  assert.deepEqual(cursor.consume(fake(100,[event(99),event(100)])),[]);
  assert.deepEqual(cursor.consume(fake(101,[event(101)])).map(e=>e.id),[101]);
});

test('burst merge preserves event order and actors while unifying locations into one bounded notice',()=>{
  const merged=mergeFeedbackEvents([event(3),event(1),event(2,'b'),event(1)]);
  assert.equal(merged.kind,'summary');assert.equal(merged.count,3);assert.deepEqual(merged.eventIds,[1,2,3]);assert.deepEqual(merged.actorIds,['a','b']);
  assert.equal(merged.targets.length,2);assert.match(merged.text,/另有 1 项公开行动/);assert.equal(mergeFeedbackEvents([]),null);
});

test('semantic burst groups repeated public text while retaining every event and location',()=>{
  const first={...event(1,'a','production',0),text:'甲掷出 8，地块产出。'},second={...event(2,'a','production',1),text:first.text};
  const merged=mergeFeedbackEvents([second,event(3,'b'),first,first]);
  assert.equal(merged.text,'甲掷出 8，地块产出。（2 次） · b 行动 3');
  assert.deepEqual(merged.eventIds,[1,2,3]);assert.equal(merged.count,3);assert.deepEqual(merged.actorIds,['a','b']);
  assert.deepEqual(merged.targets,[{kind:'tile',id:0},{kind:'tile',id:1},{kind:'edge',id:1}]);
});

test('discard summaries retain distinct actors even with identical names and reject private metadata',()=>{
  const events=['a','b','c'].map((actorId,index)=>({...event(index+1,actorId,'discard'),text:'同名玩家 完成弃牌。',targets:[],cards:{wood:8},secret:'hidden-discard'}));
  const baseline=fake(0,[]);baseline.players.push({id:'c'});const cursor=new ActionFeedbackCursor();cursor.consume(baseline);
  const next=fake(3,events);next.players=baseline.players;const merged=mergeFeedbackEvents(cursor.consume(next));
  assert.deepEqual(merged.actorIds,['a','b','c']);assert.deepEqual(merged.eventIds,[1,2,3]);assert.equal(merged.count,3);
  assert.match(merged.text,/另有 1 项公开行动/);assert.ok(!merged.text.includes('次'));assert.ok(!JSON.stringify(merged).includes('wood'));assert.ok(!JSON.stringify(merged).includes('hidden-discard'));
});

test('successful room command retries never append a second presentation event',()=>{
  const room=new Room();room.record.game=setup();room.record.hostId='p0';room.record.game.hostId='p0';room.record.game.phase='action';grant(room.record.game,'p0',{wood:1,brick:1});
  const message={id:'road-command-once',revision:room.record.revision,action:{type:'buildRoad',edge:legal(room.record.game,'p0').road[0]}};
  const sequence=room.record.game.presentation.sequence;room.handle('p0',message);
  assert.equal(room.record.game.presentation.sequence,sequence+1);const accepted=structuredClone(room.record.game.presentation),revision=room.record.revision;
  room.handle('p0',message);assert.equal(room.record.revision,revision);assert.deepEqual(room.record.game.presentation,accepted);
  assert.equal(room.snapshot('p0').state.presentation.sequence,sequence+1);
});
