import test from 'node:test';
import assert from 'node:assert/strict';
import {chacha20Block,createRandomStream,nextRandomWord,uniformInteger,randomIndex,shuffle,validRandomStream} from '../shared/random.js';
import {createBoard} from '../shared/board.js';
import {createGame,addPlayer,act,viewFor,botAction} from '../shared/game.js';
import {Room} from '../shared/room.js';
import {publicError} from '../shared/errors.js';
import {createCipheriv} from 'node:crypto';
const seed=Array.from({length:11},(_,i)=>0x01020300+i);
const words=hex=>Array.from({length:hex.length/8},(_,i)=>Number.parseInt(hex.slice(i*8,i*8+8).match(/../g).reverse().join(''),16));
test('RFC 8439 section 2.3.2 complete block vector and little endian serialization',()=>{
  const key=words('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  const nonce=words('000000090000004a00000000');
  assert.deepEqual(chacha20Block(key,nonce,1),words('10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4ed2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e'));
});
test('independent Node/OpenSSL ChaCha20 agrees for zero, patterned and final counter vectors',()=>{
  for(const value of [0,0x01020304,0xffffffff])for(const counter of [0,1,0xffffffff]){
    const key=Array(8).fill(value),nonce=[value,0,19],keyBytes=Buffer.alloc(32),iv=Buffer.alloc(16);
    key.forEach((word,i)=>keyBytes.writeUInt32LE(word,i*4));[counter,...nonce].forEach((word,i)=>iv.writeUInt32LE(word,i*4));
    const expected=createCipheriv('chacha20',keyBytes,iv).update(Buffer.alloc(64));
    assert.deepEqual(chacha20Block(key,nonce,counter),Array.from({length:16},(_,i)=>expected.readUInt32LE(i*4)));
  }
});
test('stream survives JSON round trips at empty, partial and exact block boundaries',()=>{
  for(const offset of [0,1,15,16,17,63]){
    const stream=createRandomStream(seed);for(let i=0;i<offset;i++)nextRandomWord(stream);
    const restored=JSON.parse(JSON.stringify(stream));
    for(let i=0;i<250;i++)assert.equal(nextRandomWord(restored),nextRandomWord(stream));
    assert.deepEqual(restored,stream);
  }
  const fresh=createRandomStream();assert.equal(validRandomStream(fresh),true);assert.notDeepEqual(fresh.key,createRandomStream().key);
});
test('unbiased integer rejection, unit/full range and invalid inputs',()=>{
  const values=[0xffffffff,0xfffffffe,0xfffffffd,4];let draws=0;
  assert.equal(uniformInteger(6,()=>{draws++;return values.shift();}),5);assert.equal(draws,4);
  assert.equal(uniformInteger(1,()=>0xffffffff),1);assert.equal(uniformInteger(0x100000000,()=>0xffffffff),0x100000000);
  for(const max of [0,-1,1.5,NaN,Infinity,0x100000001])assert.throws(()=>uniformInteger(max,()=>0));
  for(const word of [-1,1.2,NaN,Infinity,0x100000000])assert.throws(()=>uniformInteger(6,()=>word));
  for(const float of [-1,NaN,1,Infinity])assert.throws(()=>randomIndex(6,()=>float));
});
test('Fisher–Yates uses decreasing inclusive bounds, preserves input and all six permutations',()=>{
  const input=['a','b','c'],permutations=new Set();
  for(let a=0;a<3;a++)for(let b=0;b<2;b++){
    const values=[a/3,b/2];const result=shuffle(input,()=>values.shift());assert.equal(values.length,0);permutations.add(result.join(''));
  }
  assert.equal(permutations.size,6);assert.deepEqual(input,['a','b','c']);
  const stream=createRandomStream(seed),before=structuredClone(stream);assert.deepEqual(shuffle([],stream),[]);assert.deepEqual(shuffle([1],stream),[1]);assert.deepEqual(stream,before);
});
test('malformed streams and counter exhaustion fail without wrapping or exposing parameters',()=>{
  for(const change of [{algorithm:'lcg'},{key:[1]},{nonce:[-1,0,0]},{counter:-1},{offset:1},{words:Array(16).fill(0),counter:0}]){
    const bad={...createRandomStream(seed),...change};assert.equal(validRandomStream(bad),false);assert.throws(()=>nextRandomWord(bad));
  }
  const last=createRandomStream(seed);last.counter=0xffffffff;last.words=Array(16).fill(0);last.offset=16;
  const block=chacha20Block(last.key,last.nonce,0xffffffff);for(const word of block)assert.equal(nextRandomWord(last),word);
  const before=structuredClone(last);assert.throws(()=>nextRandomWord(last),/耗尽/);assert.deepEqual(last,before);
  const error=new Error(JSON.stringify(last));assert.deepEqual(publicError(error),{message:'服务暂时不可用，请稍后重试。'});
});
function fixture(n=3){
  const room=new Room();room.record.game=createGame(n>=5?{playerExpansion:'five-six-2025'}:{},seed);
  room.record.random=room.record.game.random;delete room.record.game.random;
  const ids=Array.from({length:n},(_,i)=>room.join('hash'+i,'玩家'+i));for(const p of room.record.game.players)p.ready=true;
  room.presence(ids);return {room,ids};
}
function send(room,id,action,extra={}){return room.handle(id,{id:crypto.randomUUID(),revision:room.record.revision,action,...extra});}
test('map retry limit explicitly fails atomically; expansion keeps its distinct number sequence and ordered first player',()=>{
  assert.throws(()=>createBoard(()=>0),/重试上限/);
  const {room,ids}=fixture(),before=structuredClone(room.record);
  // A depleted stream also fails without committing a partial terrain/deck.
  room.record.random.counter=0x100000000;room.record.random.words=Array(16).fill(0);room.record.random.offset=16;
  const depleted=structuredClone(room.record);assert.throws(()=>send(room,ids[0],{type:'start'}));assert.deepEqual(room.record,depleted);
  const g=createGame({playerExpansion:'five-six-2025'},seed);for(let i=0;i<5;i++)addPlayer(g,'p'+i,'玩家'+i,true);
  const started=act(g,'p0',{type:'start'});assert.equal(started.turn,0);assert.equal(started.board.tiles.length,30);
  assert.deepEqual(started.board.tiles.filter(t=>t.resource!=='desert').map(t=>t.number).sort((a,b)=>a-b),[2,5,4,6,3,9,8,11,11,10,6,3,8,4,8,10,11,12,10,5,4,9,5,9,12,3,2,6].sort((a,b)=>a-b));
  assert.equal(before.random.offset,0);
});
test('illegal/stale/duplicate requests preserve the stream; restart and retry reproduce dice, deck and theft',()=>{
  for(const n of [3,6]){
    const {room,ids}=fixture(n),id=crypto.randomUUID(),start={id,revision:room.record.revision,action:{type:'start'}};
    room.handle(ids[0],start);const afterStart=structuredClone(room.record);room.handle(ids[0],start);assert.deepEqual(room.record,afterStart);
    while(room.record.game.phase.startsWith('setup')){const g=room.record.game;send(room,g.players[g.turn].id,botAction(g,g.players[g.turn].id));}
    const before=structuredClone(room.record);assert.throws(()=>send(room,ids[1],{type:'roll'}));assert.throws(()=>send(room,ids[0],{type:'roll'},{revision:0}));assert.deepEqual(room.record,before);
    const restored=new Room(JSON.parse(JSON.stringify(before))),roll={id:crypto.randomUUID(),revision:before.revision,action:{type:'roll'}};
    room.handle(ids[0],roll);restored.handle(ids[0],roll);assert.deepEqual(room.record.random,restored.record.random);assert.deepEqual(room.record.game.dice,restored.record.game.dice);
    const afterRoll=structuredClone(room.record);room.handle(ids[0],roll);assert.deepEqual(room.record,afterRoll);
    const g=room.record.game;g.phase='steal';g.turn=0;const victim=g.players[1];victim.hand={wood:2,brick:1,sheep:3,wheat:1,ore:0};g.board.vertices[g.board.tiles[g.robber].vertices[0]].owner=victim.id;
    const theftBefore=structuredClone(room.record),other=new Room(structuredClone(theftBefore)),theft={id:crypto.randomUUID(),revision:theftBefore.revision,action:{type:'steal',victim:victim.id}};
    room.handle(ids[0],theft);other.handle(ids[0],theft);assert.deepEqual(room.record.game.players,other.record.game.players);assert.deepEqual(room.record.random,other.record.random);
    const final=structuredClone(room.record);room.handle(ids[0],theft);assert.deepEqual(room.record,final);
  }
});
test('legacy saves keep existing map, deck, hands and turn; migrate once and every projection excludes secrets',()=>{
  const {room,ids}=fixture();send(room,ids[0],{type:'start'});const legacy=structuredClone(room.record);delete legacy.random;legacy.version=2;
  const savedGame=structuredClone(legacy.game),migrated=new Room(legacy),again=new Room(JSON.parse(JSON.stringify(migrated.record)));
  assert.equal(migrated.record.game.random,undefined,'persisted game objects remain safe for legacy projections');
  assert.deepEqual(migrated.record.random,again.record.random);const random=migrated.record.random;assert.deepEqual(migrated.record.game,savedGame);
  migrated.record.game.futureSecret={key:random.key};migrated.record.game.players[0].internalSecret='never-publish';
  for(const id of ids){const view=viewFor(migrated.record.game,id),snapshot=migrated.snapshot(id);for(const value of [view,snapshot,migrated.summary('ABC234'),migrated.metadata()]){
    const raw=JSON.stringify(value);for(const field of ['"random"','"key"','"nonce"','"words"','"offset"','"counter"','futureSecret','internalSecret','hash0'])assert.ok(!raw.includes(field),field);
  }}
  const broken=structuredClone(migrated.record);broken.random.algorithm='unknown';assert.throws(()=>new Room(broken));
  broken.random=null;assert.throws(()=>new Room(broken));
});
