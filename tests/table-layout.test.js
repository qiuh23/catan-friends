import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredTask } from '../src/table-layout.js';

const table={board:{},me:'b',players:[{id:'a'},{id:'b'}],turn:0,turnNo:4,phase:'action',room:{}};
test('off-turn discards take priority over incoming offers and optional panels',()=>{
  const state={...table,phase:'discard',discards:{b:5},offer:{id:'trade-1',from:'a'}};
  assert.match(requiredTask(state).title,/5/);
  assert.match(requiredTask(state).key,/^discard/);
  assert.match(requiredTask({...state,discards:{}}).key,/^offer/);
});
test('only the player who must steal gets the task, while all recipients see incoming trades',()=>{
  assert.equal(requiredTask({...table,phase:'steal'}),null);
  assert.match(requiredTask({...table,phase:'steal',turn:1}).key,/^steal/);
  assert.match(requiredTask({...table,offer:{id:'t',from:'a'}}).key,/^offer/);
  assert.equal(requiredTask({...table,offer:{id:'t',from:'b'}}),null);
});
test('pause supersedes action tasks and finished or absent boards do not announce stale work',()=>{
  assert.equal(requiredTask({...table,room:{paused:true},phase:'discard',discards:{b:3}}).key,'paused');
  assert.equal(requiredTask({...table,phase:'finished',offer:{id:'t',from:'a'}}),null);
  assert.equal(requiredTask({...table,board:null}),null);
});
