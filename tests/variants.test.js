import {withStartingRolls} from './fixtures/starting-rolls.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyHand, RESOURCES } from '../shared/board.js';
import { createGame, addPlayer, act, viewFor, legal, points, updateAwards, botAction, total, normalizeOptions } from '../shared/game.js';

const rng = (seed = 42) => () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
function lobby(options = {}, n = 3) { const g=createGame(options); for(let i=0;i<n;i++)addPlayer(g,`p${i}`,`玩家${i}`,true); return g; }
function setup(options = {}, n = 3) {
  let g=act(lobby(options,n),'p0',{type:'start'},withStartingRolls(n,rng()));
  while(g.phase.startsWith('setup')) { const id=g.players[g.turn].id; g=act(g,id,botAction(g,id)); }
  return g;
}
function resetBuildings(g) { for(const v of g.board.vertices){v.owner=null;v.level=0;} for(const e of g.board.edges)e.owner=null; }
function place(g, id, vertex, level=1) { Object.assign(g.board.vertices[vertex],{owner:id,level}); }
function give(g,id,cards) { const p=g.players.find(p=>p.id===id); for(const r of RESOURCES){g.bank[r]+=p.hand[r]; p.hand[r]=cards[r]||0;g.bank[r]-=p.hand[r];} }
function assertConserved(g) { for(const r of RESOURCES)assert.equal(g.bank[r]+g.players.reduce((n,p)=>n+p.hand[r],0),19,r); }

test('base default and legacy saves keep ten-point rules; unknown or malformed variants are rejected',()=>{
  const g=createGame(); assert.deepEqual(g.options,{friendlyRobber:false,harbormaster:false,playerExpansion:'base'}); assert.equal(g.targetPoints,10);
  for(const bad of [null,[],true,{seafarers:true},{friendlyRobber:'yes'},{harbormaster:1}])assert.throws(()=>normalizeOptions(bad));
  const old=setup(); delete old.options;delete old.targetPoints;delete old.harbormaster;
  const v=viewFor(old,'p0');assert.deepEqual(v.options,g.options);assert.equal(v.targetPoints,10);assert.equal(v.harbormaster,null);
  assert.doesNotThrow(()=>act(old,'p0',{type:'roll'},()=>0));
});

test('finished views show scores without publishing opponents remaining resources or development identities',()=>{
  const g=setup();g.phase='finished';g.players[1].dev.push({id:'still-private',type:'victory',bought:0});
  const v=viewFor(g,'p0');assert.equal(v.players[1].points,3);assert.equal(v.players[1].hand,undefined);assert.equal(v.players[1].dev,undefined);
  assert.ok(!JSON.stringify(v).includes('still-private'));assert.ok(v.players[0].hand);assert.ok(v.players[0].dev);
});

test('only the current host may change variants before start, and humans must ready again',()=>{
  let g=lobby();g.players.forEach(p=>{p.bot=false;p.ready=true;});g.hostId='p1';
  assert.throws(()=>act(g,'p0',{type:'setOptions',options:{harbormaster:true}}),/房主/);
  g=act(g,'p1',{type:'setOptions',options:{friendlyRobber:true,harbormaster:true}});
  assert.equal(g.targetPoints,11);assert.ok(g.players.every(p=>!p.ready));
  g=act(g,'p0',{type:'ready',ready:true});g=act(g,'p0',{type:'ready',ready:true});assert.equal(g.players[0].ready,true);
  g=act(g,'p2',{type:'ready',ready:true});g=act(g,'p1',{type:'start'},rng());
  assert.throws(()=>act(g,'p1',{type:'setOptions',options:{}}),/开局前/);
});

test('friendly robber protects public two-point buildings even with hidden victory cards; base permits them',()=>{
  const g=setup({friendlyRobber:true});g.phase='robber';g.resumePhase='action';
  g.players[1].dev.push({id:'private-vp',type:'victory',bought:0});
  const occupied=g.board.vertices.filter(v=>v.owner==='p1').flatMap(v=>v.tiles).filter(t=>t!==g.robber);
  assert.ok(occupied.length);for(const tile of occupied){assert.ok(!legal(g,'p0').robber.includes(tile));assert.throws(()=>act(g,'p0',{type:'moveRobber',tile}),/友善强盗/);}
  const oldLegal=legal(g,'p0').robber;g.players[1].dev=[];assert.deepEqual(legal(g,'p0').robber,oldLegal);
  g.options.friendlyRobber=false;assert.ok(occupied.every(t=>legal(g,'p0').robber.includes(t)));
  assert.ok(!JSON.stringify(viewFor(g,'p0')).includes('private-vp'));
});

test('friendly robber applies to knights, still discards on seven, and permits stealing once public score is three',()=>{
  let g=setup({friendlyRobber:true});give(g,'p1',{brick:9});g.players[0].dev.push({id:'knight',type:'knight',bought:0});
  const knight=act(g,'p0',{type:'playDevelopment',cardId:'knight'});assert.equal(knight.phase,'robber');assert.deepEqual(knight.discards,{});
  assert.ok(g.board.vertices.filter(v=>v.owner==='p1').flatMap(v=>v.tiles).filter(t=>t!==g.robber).every(t=>!legal(knight,'p0').robber.includes(t)));
  let roll=0;g=act(g,'p0',{type:'roll'},()=>[0,.999][roll++]);assert.equal(g.phase,'discard');assert.equal(g.discards.p1,4);
  g=act(g,'p1',{type:'discard',cards:{brick:4}});assert.equal(g.phase,'robber');assertConserved(g);
  resetBuildings(g);const target=g.board.tiles.find(t=>t.id!==g.robber && t.resource!=='desert');
  place(g,'p1',target.vertices[0],2);place(g,'p1',g.board.vertices.find(v=>!target.vertices.includes(v.id)).id,1);
  assert.equal(points(g,'p1',false),3);assert.ok(legal(g,'p0').robber.includes(target.id));
  g=act(g,'p0',{type:'moveRobber',tile:target.id});assert.equal(g.phase,'steal');assert.deepEqual(legal(g,'p0').victims,['p1']);
  g=act(g,'p0',{type:'steal',victim:'p1'},()=>0);assert.equal(g.phase,'action');assertConserved(g);
});

test('sixth-edition friendly robber falls back to desert with no valid destination and cannot steal protected cards',()=>{
  let g=setup({friendlyRobber:true});g.phase='robber';g.resumePhase='roll';resetBuildings(g);
  // A compact fixture makes every hex adjacent to a public two-point player.
  g.board.tiles=[{id:0,resource:'desert',vertices:[0]},{id:1,resource:'wood',vertices:[1]}];g.robber=0;
  g.board.vertices=g.board.vertices.slice(0,2);place(g,'p0',0,1);place(g,'p1',1,1);give(g,'p1',{wood:1});
  assert.deepEqual(legal(g,'p0').robber,[0]);g=act(g,'p0',{type:'moveRobber',tile:0});assert.equal(g.robber,0);assert.equal(g.phase,'roll');
  g.phase='robber';g.board.tiles[0].vertices=[0,1];assert.deepEqual(legal(g,'p0').victims,[]);
});

test('harbors award counts port buildings and cities, retains ties, and transfers only to a stronger player',()=>{
  const g=setup({harbormaster:true});resetBuildings(g);const ports=g.board.ports;
  place(g,'p0',ports[0].vertices[0],2);place(g,'p0',ports[1].vertices[0]);
  // A road reaching a harbor is not a port building.
  g.board.edges[ports[2].edge].owner='p2';updateAwards(g);
  assert.equal(g.players[0].harborPoints,3);assert.equal(g.players[2].harborPoints,0);assert.equal(g.harbormaster,'p0');assert.equal(points(g,'p0'),5);
  place(g,'p1',ports[3].vertices[0],2);place(g,'p1',ports[4].vertices[0]);updateAwards(g);assert.equal(g.harbormaster,'p0');
  place(g,'p1',ports[5].vertices[0]);updateAwards(g);assert.equal(g.harbormaster,'p1');assert.equal(points(g,'p0'),3);
  assert.equal(viewFor(g,'p2').harbormaster,'p1');assert.equal(viewFor(g,'p2').targetPoints,11);
});

test('city upgrade can claim Strongest Ports and wins at eleven, while ten is insufficient',()=>{
  let g=setup({harbormaster:true});resetBuildings(g);g.phase='action';const ports=g.board.ports;
  place(g,'p0',ports[0].vertices[0],1);place(g,'p0',ports[1].vertices[0],1);
  const inland=g.board.vertices.find(v=>v.owner===null && !ports.some(p=>p.vertices.includes(v.id)));place(g,'p0',inland.id,2);
  g.players[0].dev=Array.from({length:4},(_,i)=>({id:`vp-${i}`,type:'victory',bought:0}));updateAwards(g);assert.equal(points(g,'p0'),8);
  give(g,'p0',{wheat:2,ore:3});g=act(g,'p0',{type:'buildCity',vertex:ports[0].vertices[0]});
  assert.equal(g.harbormaster,'p0');assert.equal(g.players[0].harborPoints,3);assert.equal(points(g,'p0'),11);assert.equal(g.phase,'finished');
  let ten=setup({harbormaster:true});ten.phase='action';ten.players[0].dev=Array.from({length:8},(_,i)=>({id:String(i),type:'victory',bought:0}));
  ten=act(ten,'p0',{type:'endTurn'});assert.equal(ten.winner,null);assert.equal(ten.phase,'roll');
});

test('bank shortages pay the sole claimant partially and pay no claimant when several compete',()=>{
  const g=setup();resetBuildings(g);for(const p of g.players)give(g,p.id,emptyHand());
  const tile=g.board.tiles.find(t=>t.number===6);g.robber=g.board.tiles.find(t=>t.resource==='desert').id;
  place(g,'p0',tile.vertices[0],2);give(g,'p2',{[tile.resource]:18});
  let single=act(g,'p0',{type:'roll'},()=>2/6+.001);assert.equal(single.players[0].hand[tile.resource],1);assertConserved(single);
  place(g,'p1',tile.vertices[2]);single=act(g,'p0',{type:'roll'},()=>2/6+.001);
  assert.equal(single.players[0].hand[tile.resource],0);assert.equal(single.players[1].hand[tile.resource],0);assertConserved(single);
});

test('3 and 4 player bots finish each complete variant and their combination with conserved resources',()=>{
  for(const n of [3,4])for(const options of [{friendlyRobber:true},{harbormaster:true},{friendlyRobber:true,harbormaster:true}]) {
    const random=rng(n*17+(options.friendlyRobber?1:0)+(options.harbormaster?2:0));let g=act(lobby(options,n),'p0',{type:'start'},random),steps=0;
    while(g.phase!=='finished' && steps++<14000) {
      const p=g.phase==='discard' ? g.players.find(p=>g.discards[p.id]) : g.players[g.turn];
      const action=botAction(g,p.id);assert.ok(action,`no action ${g.phase}`);g=act(g,p.id,action,random);assertConserved(g);
    }
    assert.equal(g.phase,'finished',`${n} players ${JSON.stringify(options)} failed in ${steps} actions`);assert.ok(points(g,g.winner)>=g.targetPoints);
  }
});
