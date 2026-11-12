import test from 'node:test';
import assert from 'node:assert/strict';
import {NoticeQueue} from '../src/notice-queue.js';
import {mergeFeedbackEvents} from '../src/action-feedback.js';

function fixture(options={}) {
  let time=0,id=0;const timers=new Map(),all=[],shown=[];
  const queue=new NoticeQueue({show:value=>shown.push(value),now:()=>time,setTimer:(callback,ms)=>{const next=++id;timers.set(next,{callback,at:time+ms});all.push(callback);return next;},clearTimer:id=>timers.delete(id),...options});
  const tick=ms=>{const end=time+ms;for(;;){const next=[...timers].toSorted((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;time=next[1].at;timers.delete(next[0]);next[1].callback();}time=end;};
  return {queue,tick,shown,all,timers};
}
const event=id=>({id,kind:'road',actorId:'p0',text:`修建道路 ${id}`,targets:[{kind:'edge',id}]});

test('rapid toasts preserve reading time, deduplicate active/pending text and have no empty frame between notices',()=>{
  const {queue,tick,shown}=fixture();queue.push('失败');tick(0);
  tick(20);queue.push('失败');queue.push('连接中');queue.push('连接中');queue.push('完成');
  tick(3179);assert.deepEqual(shown,['失败']);tick(1);assert.deepEqual(shown,['失败','连接中']);
  tick(3200);assert.deepEqual(shown,['失败','连接中','完成']);tick(3200);assert.deepEqual(shown,['失败','连接中','完成',null]);
});
test('the initial public burst waits 180ms and later events never change its text or anchor early',()=>{
  const {queue,tick,shown}=fixture({delay:180,key:e=>e.id,merge:mergeFeedbackEvents,duration:()=>2800});
  queue.push(event(1));tick(90);queue.push(event(2));tick(89);assert.deepEqual(shown,[]);tick(1);
  assert.deepEqual(shown[0].eventIds,[1,2]);assert.deepEqual(shown[0].bubbleTarget,{kind:'edge',id:2});
  const first=queue.current;
  for(let i=3;i<=100;i++){queue.push(event(i));tick(2);}
  assert.equal(queue.current,first);tick(2604);
  assert.equal(shown.length,2);assert.deepEqual(shown[1].eventIds,Array.from({length:98},(_,i)=>i+3));
  assert.equal(shown[1].count,98);assert.equal(shown[1].bubbleTarget.id,100);
});
test('clear invalidates already queued timeout callbacks on room switch, reconnect and dismissal',()=>{
  const {queue,tick,shown,all}=fixture();queue.push('旧房间');tick(0);const stale=all.at(-1);
  queue.clear();queue.push('新房间');tick(0);stale();assert.equal(queue.current,'新房间');
  tick(3200);assert.deepEqual(shown,['旧房间',null,'新房间',null]);
});
test('modal and hidden-page pauses preserve remaining lifetime and resume once',()=>{
  const {queue,tick,shown,timers}=fixture();queue.push('第一条');tick(0);tick(1000);queue.pause();queue.push('第二条');
  assert.equal(timers.size,0);tick(100000);assert.deepEqual(shown,['第一条']);queue.pause();queue.pause(false);queue.pause(false);
  tick(2199);assert.equal(queue.current,'第一条');tick(1);assert.equal(queue.current,'第二条');
});
test('a paused initial burst waits until visible and clear does not revive it',()=>{
  const {queue,tick,shown}=fixture({delay:180});queue.pause();queue.push('等待');tick(1000);assert.deepEqual(shown,[]);
  queue.clear();queue.pause(false);tick(1000);assert.deepEqual(shown,[null]);
});

test('long modal sessions bound public-event memory and preserve the omitted count in the summary',()=>{
  const {queue,tick}=fixture({key:e=>e.id,pendingLimit:80,merge:(events,omitted)=>({...mergeFeedbackEvents(events),omitted})});
  queue.pause();for(let i=1;i<=1000;i++)queue.push(event(i));
  assert.equal(queue.pending.length,80);queue.pause(false);tick(0);
  assert.equal(queue.current.omitted,920);assert.equal(queue.current.eventIds.length,80);assert.equal(queue.current.bubbleTarget.id,1000);
});
test('a targetless latest event keeps its actor anchor, even after construction in the same burst',()=>{
  const merged=mergeFeedbackEvents([event(1),{...event(2),targets:[],text:'购买发展卡'}]);
  assert.equal(merged.bubbleTarget,null);assert.equal(merged.latestText,'购买发展卡');assert.equal(merged.targets.length,1);
});
