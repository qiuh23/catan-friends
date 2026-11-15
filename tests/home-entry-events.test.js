import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readRoom} from '../src/invitation.js';
import {installDialogDismissal} from '../src/dialogs.js';
const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
// Exercise the shipped entry callbacks with isolated DOM/network ports. This is
// deliberately not a browser or a claim about browser-rendered visual layout.
test('inline join preserves its draft, toggles repeatedly and never opens a dialog or navigates',async()=>{
  let saved=0,rendered=0,focused=0;const code={value:'A-ABC234',focus(){focused++;}};
  const ctx=vm.createContext({joinExpanded:false,saveDrafts(){saved++;},render(){rendered++;},$:s=>{assert.equal(s,'#join-code');return code;}});
  const toggle=vm.runInContext(`(async()=>{const action='toggleJoin';${between("if(action==='toggleJoin')","  if(action==='homePractice')")}})`,ctx);
  await toggle();assert.equal(ctx.joinExpanded,true);await toggle();assert.equal(ctx.joinExpanded,false);await toggle();assert.equal(code.value,'A-ABC234');assert.equal(saved,3);assert.equal(rendered,3);assert.equal(focused,2);
});

test('joining uses the inline nickname and same-station code; invalid/foreign codes never connect',()=>{
  for(const backendId of ['aliyun','cloudflare']){
    const prefix=backendId==='aliyun'?'A':'C',opposite=prefix==='A'?'C':'A',connected=[],toasts=[];
    const code={value:`${prefix}-ABC234`};
    const ctx=vm.createContext({entryError:'',entryNickname:id=>{assert.equal(id,'join-nickname');return 'friend';},readRoom,backendId,$:()=>code,storage:{get:()=>null},newId:()=> 'token',connect:(...args)=>connected.push(args),toast:t=>toasts.push(t)});
    vm.runInContext(between('function join(){','\nconst statusText='),ctx);
    ctx.join();assert.deepEqual(connected,[['ABC234','token','friend']]);
    for(const invalid of ['bad',`${opposite}-ABC234`]){code.value=invalid;ctx.join();}
    assert.equal(connected.length,1);assert.equal(toasts.length,2);
    ctx.entryNickname=()=>'';code.value=`${prefix}-ABC234`;ctx.join();assert.equal(connected.length,1);
  }
});

test('create and practice preserve edition identity, options, seat count and private practice protocol',async()=>{
  for(const domestic of [false,true])for(const practice of [false,true]){
    const requests=[],connected=[];let closed=0;
    const ctx=vm.createContext({entryError:'',DOMESTIC:domestic,busy:false,
      entryNickname:id=>{assert.equal(id,practice?'practice-nickname':'nickname');return domestic?'nickname-id':'friend';},
      readCount:()=>6,readOptions:prefix=>({friendlyRobber:true,harbormaster:true,...(prefix==='practice'?{playerExpansion:'five-six-2025'}:{})}),
      $:s=>s==='#create-visibility'?{value:'public'}:{close(){closed++;}},
      render(){},newId:()=> 'token',fetch:async(url,options)=>{requests.push([url,JSON.parse(options.body)]);return {ok:true,json:async()=>({code:'ABC234'})};},
      connect:(...args)=>connected.push(args),toast:t=>assert.fail(t)});
    vm.runInContext(between('async function create(practice=false){','\nfunction join(){'),ctx);
    await ctx.create(practice);const [url,payload]=requests[0];assert.equal(url,'/api/rooms');assert.equal(payload.practice,practice);assert.equal(payload.visibility,practice?'private':'public');assert.equal(payload.playerCount,practice?6:undefined);assert.equal(payload[domestic?'nicknameId':'name'],domestic?'nickname-id':'friend');assert.equal(payload.options.friendlyRobber,true);assert.equal(payload.options.harbormaster,true);assert.equal(payload.options.playerExpansion,practice?'five-six-2025':undefined);assert.equal(closed,1);assert.equal(connected.length,1);assert.equal(ctx.busy,false);
  }
});

test('room code copies only the station-prefixed code and reports clipboard failure without changing room',async()=>{
  for(const failing of [false,true]){
    const copied=[],toasts=[];
    const ctx=vm.createContext({code:'ABC234',displayCode:code=>'C-'+code,navigator:{clipboard:{writeText:async v=>{if(failing)throw Error('unavailable');copied.push(v);}}},toast:v=>toasts.push(v)});
    const copy=vm.runInContext(`(async()=>{const action='copyRoomCode';${between("if(action==='copyRoomCode')","  if(action==='invite')")}})`,ctx);
    await copy();assert.deepEqual(copied,failing?[]:['C-ABC234']);assert.equal(toasts.length,1);assert.equal(ctx.code,'ABC234');if(failing)assert.ok(toasts[0].includes('C-ABC234'));
  }
});

test('rules dismissal supports a full outside click, native Escape, close button and repeated opening',async()=>{
  const old={document:globalThis.document,window:globalThis.window,location:globalThis.location,history:globalThis.history};
  class Dialog extends EventTarget {
    id='rules-dialog';open=false;
    showModal(){this.open=true;}
    close(){if(!this.open)return;this.open=false;this.dispatchEvent(new Event('close'));}
    getBoundingClientRect(){return {left:10,right:100,top:10,bottom:100};}
    pointer(type,x,y){const e=new Event(type);Object.assign(e,{clientX:x,clientY:y});this.dispatchEvent(e);}
    escape(){const e=new Event('cancel',{cancelable:true});if(this.dispatchEvent(e))this.close();}
  }
  const dialog=new Dialog(),window=new EventTarget();let saved=0,renders=0;
  Object.assign(globalThis,{document:{querySelectorAll:()=>[dialog]},window,location:{href:'https://example.test/'},history:{state:null,pushState(state){this.state=state;},replaceState(state){this.state=state;},back(){this.state=null;queueMicrotask(()=>window.dispatchEvent(new Event('popstate')));}}});
  const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
  try{
    installDialogDismissal({beforeClose(){saved++;}});
    dialog.showModal();await flush();dialog.pointer('pointerdown',20,20);dialog.pointer('click',0,0);assert.equal(dialog.open,true,'dragging outside must not dismiss');
    dialog.pointer('pointerdown',0,0);dialog.pointer('click',0,0);assert.equal(dialog.open,false);await flush();assert.equal(history.state,null);
    dialog.showModal();await flush();dialog.escape();assert.equal(dialog.open,false);await flush();assert.equal(history.state,null);
    dialog.showModal();await flush();
    const ctx=vm.createContext({$:()=>dialog,render(){renders++;}});
    const close=vm.runInContext(`(()=>{const action='closeRules';${between("if(action==='closeRules')","\n  if(action==='reset')")}})`,ctx);
    close();assert.equal(dialog.open,false);await flush();assert.equal(history.state,null);assert.equal(renders,1);assert.ok(saved>=3);
  }finally{for(const [key,value]of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
