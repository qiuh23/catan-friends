import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoard,RESOURCES} from '../shared/board.js';
import {createGame,addPlayer,act,botAction,viewFor,points,ruleProfile,total} from '../shared/game.js';

const options={playerExpansion:'five-six-2025'};
const rng=(seed=42)=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function lobby(n=6,rules=options){const g=createGame(rules);for(let i=0;i<n;i++)addPlayer(g,`p${i}`,`玩家${i}`,true);return g;}
function setup(n=6,rules=options){let g=act(lobby(n,rules),'p0',{type:'start'},rng());while(g.phase.startsWith('setup')){const id=g.players[g.turn].id;g=act(g,id,botAction(g,id));}return g;}
function give(g,id,cards){const p=g.players.find(p=>p.id===id);for(const r of RESOURCES){g.bank[r]+=p.hand[r];p.hand[r]=cards[r]||0;g.bank[r]-=p.hand[r];}}
function conserved(g){for(const r of RESOURCES)assert.equal(g.bank[r]+g.players.reduce((n,p)=>n+p.hand[r],0),24,r);}

test('2025 five-six profile has all additional components and exact number-token distribution',()=>{
  assert.deepEqual(ruleProfile(options),{id:'five-six-2025',version:'2025',minPlayers:5,maxPlayers:6,resourceCount:24,landHexes:30,developmentCards:34,turnRule:'paired'});
  for(let seed=1;seed<=20;seed++){
    const b=createBoard(rng(seed),options);assert.equal(b.tiles.length,30);assert.equal(b.vertices.length,80);assert.equal(b.edges.length,109);assert.equal(b.ports.length,11);assert.equal(new Set(b.ports.flatMap(p=>p.vertices)).size,22);
    const count=key=>b.tiles.filter(t=>t.resource===key).length;assert.deepEqual(RESOURCES.map(count),[6,5,6,6,5]);assert.equal(count('desert'),2);
    for(const n of [2,3,4,5,6,8,9,10,11,12])assert.equal(b.tiles.filter(t=>t.number===n).length,[2,12].includes(n)?2:3);
    assert.equal(b.ports.filter(p=>p.resource==='any').length,5);assert.equal(b.ports.filter(p=>p.resource==='sheep').length,2);
    assert.deepEqual([-3,-2,-1,0,1,2,3].map(r=>b.tiles.filter(t=>t.r===r).length),[3,4,5,6,5,4,3]);
  }
  const g=act(lobby(),'p0',{type:'start'},rng());assert.equal(g.deck.length,34);assert.equal(g.deck.filter(c=>c==='knight').length,20);assert.equal(g.deck.filter(c=>c==='victory').length,5);
  for(const card of ['plenty','monopoly','roadBuilding'])assert.equal(g.deck.filter(c=>c===card).length,3);
  // Identity terrain shuffle puts deserts at hex 18 and 29. Trace the official
  // A..Zc counterclockwise sequence around those two gaps, then into the island.
  const fixed=createBoard(()=>.999,options);
  assert.deepEqual([-3,-2,-1,0,1,2,3].map(r=>fixed.tiles.filter(t=>t.r===r).map(t=>t.number)),[
    [4,5,2],[6,10,8,4],[3,11,12,9,8],[9,12,3,6,5,3],[0,10,2,9,6],[8,5,4,10],[11,11,0],
  ]);
});

test('waiting rooms accept six seats and choose the actual edition at start, preserving snake setup',()=>{
  const base=createGame();for(let i=0;i<6;i++)addPlayer(base,`p${i}`,`玩家${i}`);assert.throws(()=>addPlayer(base,'p6','第七'),/6/);
  const few=act(lobby(4),'p0',{type:'start'});assert.equal(few.options.playerExpansion,'base');assert.equal(few.board.tiles.length,19);assert.equal(few.deck.length,25);
  assert.throws(()=>addPlayer(lobby(),'p6','第七'),/6/);
  assert.throws(()=>act(lobby(5),'p0',{type:'setOptions',options:{playerExpansion:'base'}}),/实际人数/);
  for(const n of [5,6]){
    let g=act(lobby(n),'p0',{type:'start'},rng()),order=[];
    while(g.phase.startsWith('setup')){const id=g.players[g.turn].id;if(g.phase==='setup-settlement')order.push(g.turn);g=act(g,id,botAction(g,id));}
    assert.deepEqual(order,[...Array(n).keys(),...Array(n).keys()].map((v,i)=>i<n?v:n-1-v));
    assert.equal(new Set(g.players.map(p=>p.color)).size,n);assert.equal(g.phase,'roll');assert.equal(g.pairStep,'primary');
    for(const p of g.players){assert.equal(points(g,p.id),2);assert.equal(g.board.edges.filter(e=>e.owner===p.id).length,2);}
    conserved(g);assert.equal(viewFor(g,'p0').maxPlayers,6);assert.equal(viewFor(g,'p0').minPlayers,5);
  }
});

test('paired marker advances by three, player two has no production or player trade, and next pair advances by one',()=>{
  for(const n of [5,6]){
    let g=setup(n);g.phase='action';g=act(g,'p0',{type:'endTurn'});
    assert.equal(g.turn,3);assert.equal(g.primaryTurn,0);assert.equal(g.pairStep,'secondary');assert.equal(g.phase,'action');
    assert.throws(()=>act(g,'p3',{type:'roll'}),/不能掷骰/);
    give(g,'p3',{wood:8});assert.throws(()=>act(g,'p3',{type:'offerTrade',give:{wood:1},want:{ore:1}}),/玩家二/);
    const forged=structuredClone(g);forged.offer={id:'forged',from:'p0',give:{wood:1},want:{ore:1}};assert.throws(()=>act(forged,'p3',{type:'acceptTrade',offerId:'forged'}),/玩家二/);
    const before=g.players[3].hand.ore;g=act(g,'p3',{type:'bankTrade',give:'wood',want:'ore'});assert.equal(g.players[3].hand.ore,before+1);conserved(g);
    assert.throws(()=>act(g,'p0',{type:'buyDevelopment'}),/等待/);
    g=act(g,'p3',{type:'endTurn'});assert.equal(g.turn,1);assert.equal(g.primaryTurn,1);assert.equal(g.pairStep,'primary');assert.equal(g.phase,'roll');
    g.phase='action';g=act(g,'p1',{type:'endTurn'});assert.equal(g.turn,4);
    g=act(g,'p4',{type:'endTurn'});g.phase='action';g=act(g,'p2',{type:'endTurn'});assert.equal(g.turn,(2+3)%n);
  }
});

test('each paired action allows its own development card, forbids same-part purchase use, and survives save restore',()=>{
  let g=setup();g.phase='action';g.players[0].dev=[{id:'first',type:'monopoly',bought:0}];
  g=act(g,'p0',{type:'playDevelopment',cardId:'first',resource:'ore'});assert.equal(g.playedDev,true);
  g=act(g,'p0',{type:'endTurn'});assert.equal(g.playedDev,false);assert.equal(g.turn,3);
  g.players[3].dev=[{id:'second',type:'monopoly',bought:0}];g=act(g,'p3',{type:'playDevelopment',cardId:'second',resource:'wood'});assert.equal(g.playedDev,true);
  give(g,'p3',{sheep:1,wheat:1,ore:1});g.deck=['monopoly'];g=act(g,'p3',{type:'buyDevelopment'});const card=g.players[3].dev[0];
  const saved=JSON.parse(JSON.stringify(g));assert.equal(saved.primaryTurn,0);assert.equal(saved.pairStep,'secondary');assert.equal(saved.playedDev,true);
  assert.throws(()=>act(saved,'p3',{type:'playDevelopment',cardId:card.id,resource:'wood'}),/每回合/);
  assert.throws(()=>act({...saved,playedDev:false},'p3',{type:'playDevelopment',cardId:card.id,resource:'wood'}),/之前回合/);
  g=act(saved,'p3',{type:'endTurn'});
  while(g.turn!==3 || g.pairStep!=='primary'){if(g.phase==='roll')g.phase='action';g=act(g,g.players[g.turn].id,{type:'endTurn'});}
  assert.ok(g.turnNo>card.bought);g=act(g,'p3',{type:'playDevelopment',cardId:card.id,resource:'wood'});assert.equal(g.players[3].dev.length,0);
});

test('player one wins before player two, and player two can independently reach ten or eleven and win',()=>{
  let g=setup();g.phase='action';g.players[0].dev=Array.from({length:8},(_,i)=>({id:`a${i}`,type:'victory',bought:0}));g.players[3].dev=Array.from({length:8},(_,i)=>({id:`b${i}`,type:'victory',bought:0}));
  g=act(g,'p0',{type:'endTurn'});assert.equal(g.winner,'p0');assert.equal(g.phase,'finished');assert.equal(g.turn,0);
  for(const harbormaster of [false,true]){
    let second=setup(6,{...options,harbormaster});second.phase='action';second=act(second,'p0',{type:'endTurn'});
    second.players[3].dev=Array.from({length:harbormaster?8:7},(_,i)=>({id:String(i),type:'victory',bought:0}));second.deck=['victory'];give(second,'p3',{sheep:1,wheat:1,ore:1});
    second=act(second,'p3',{type:'buyDevelopment'});assert.equal(second.winner,'p3');assert.equal(second.phase,'finished');assert.equal(points(second,'p3'),harbormaster?11:10);
  }
});

test('five-six discard accepts twenty-plus resources and conserves enlarged supply',()=>{
  let g=setup(5);give(g,'p4',{wood:24});let i=0;g=act(g,'p0',{type:'roll'},()=>[0,.999][i++]);assert.equal(g.discards.p4,12);
  g=act(g,'p4',{type:'discard',cards:{wood:12}});assert.equal(g.players[4].hand.wood,12);conserved(g);
  g.phase='action';give(g,'p0',{wood:24});g=act(g,'p0',{type:'offerTrade',give:{wood:24},want:{ore:1}});assert.equal(total(g.offer.give),24);
});

test('five and six player robots finish base paired rules and the two supported combined variants',()=>{
  for(const n of [5,6])for(const variants of [{},{friendlyRobber:true},{harbormaster:true},{friendlyRobber:true,harbormaster:true}]){
    const random=rng(n*31+(variants.friendlyRobber?1:0)+(variants.harbormaster?2:0));let g=act(lobby(n,{...options,...variants}),'p0',{type:'start'},random),steps=0;
    while(g.phase!=='finished' && steps++<20000){const p=g.phase==='discard'?g.players.find(p=>g.discards[p.id]):g.players[g.turn];const a=botAction(g,p.id);assert.ok(a,`${g.phase} has no bot action`);g=act(g,p.id,a,random);conserved(g);}
    assert.equal(g.phase,'finished',`${n} players ${JSON.stringify(variants)} did not finish in ${steps}`);assert.ok(points(g,g.winner)>=g.targetPoints);
  }
});
