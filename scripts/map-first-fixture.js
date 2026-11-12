import assert from 'node:assert/strict';
import { createGame, addPlayer, act, botAction, legal, viewFor, RESOURCES } from '../shared/game.js';

export const testURL=process.env.TEST_URL||'http://127.0.0.1:5187';
export const names=['海风和很长很长的名字','松林探险家与朋友们','麦田','珊瑚','云杉','砂岩'];
export function fixture(count=6,{setup=false,turn=0}={}) {
  let seed=17+count;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  let game=createGame(count>4?{playerExpansion:'five-six-2025'}:{});
  for(let i=0;i<count;i++)addPlayer(game,`p${i}`,names[i],true);
  game=act(game,'p0',{type:'start'},random);
  if(!setup){
    while(game.phase.startsWith('setup-')){const id=game.players[game.turn].id;game=act(game,id,botAction(game,id),random);}
    game.phase='action';game.turn=turn;game.primaryTurn=turn;game.turnNo=1;
    for(const p of game.players)for(const r of RESOURCES)p.hand[r]=p.id===`p${turn}`?4:2;
    for(const r of RESOURCES)game.bank[r]=(count>4?24:19)-game.players.reduce((sum,p)=>sum+p.hand[r],0);
  }
  return game;
}
export async function entry(page){
  const trigger=page.locator('[data-action="openEntry"]');
  await page.locator('#nickname').waitFor({state:'attached'});
  if(!await page.locator('#nickname').isVisible())await trigger.click();
  await page.locator('#nickname').waitFor({state:'visible'});
}
export async function openFixture(browser,{count=6,viewport={width:1366,height:768},touch=false,reducedMotion='no-preference',setup=false,turn=0,errors=[],insets=null}={}) {
  const context=await browser.newContext({viewport,hasTouch:touch,isMobile:touch,reducedMotion});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  if(insets)await(await context.newCDPSession(page)).send('Emulation.setSafeAreaInsetsOverride',{insets});
  let game=fixture(count,{setup,turn}),socket,revision=0,chat=[],paused=false;const actions=[];
  const project=()=>{
    const view=viewFor(game,'p0');assert.ok(view.players.filter(p=>p.id!=='p0').every(p=>!('hand'in p)&&!('dev'in p)),'fixture disclosed private cards');
    return {...view,chat,room:{hostId:'p0',paused,practice:false,visibility:'private',serverNow:Date.now()},players:view.players.map(p=>({...p,online:true}))};
  };
  const publish=()=>socket?.send(JSON.stringify({type:'state',revision:++revision,state:project()}));
  await page.route('**/api/deployment',route=>route.fulfill({json:{game:'catan-friends',siteEdition:process.env.TEST_EDITION||'global',backendId:'local',publicOrigin:new URL(testURL).origin}}));
  await page.route('**/api/rooms',route=>route.fulfill({json:route.request().method()==='POST'?{code:'ABC234'}:{rooms:[]}}));
  await page.routeWebSocket('**/api/rooms/*/ws',ws=>{
    socket=ws;ws.onMessage(message=>{
      const envelope=JSON.parse(message);if(envelope.type==='hello'||envelope.type==='sync')return publish();
      if(envelope.type!=='action')return;actions.push(envelope.action);
      try{
        if(envelope.action.type==='chat')chat=[...chat,{id:`chat-${revision}`,seq:chat.length+1,sentAt:Date.now(),name:names[0],text:envelope.action.text}];
        else if(envelope.action.type==='resume')paused=false;
        else game=act(game,'p0',envelope.action,()=>.43);
        publish();ws.send(JSON.stringify({type:'ack',id:envelope.id}));
      }catch(error){ws.send(JSON.stringify({type:'error',id:envelope.id,message:error.message}));}
    });
  });
  await page.goto(testURL);await page.locator('[data-action="openEntry"]').click();if(await page.locator('#nickname').count())await page.locator('#nickname').fill(names[0]);await page.locator('#create-room').click();
  await page.locator('.playing #board canvas[data-camera]').waitFor();
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#board canvas').dataset.renderStats||'{}').pieceBuilds>0);
  await page.waitForTimeout(200);
  return {page,context,actions,get game(){return game;},publish,
    action(actor,action,random=()=>.43,{send=true}={}){game=act(game,actor,action,random);if(send)publish();return game.presentation.events.at(-1);},
    set(next,{send=true}={}){game=next;if(send)publish();},
    setPaused(value){paused=value;publish();},
    chat(text){chat=[...chat,{id:`peer-${revision}`,seq:chat.length+1,sentAt:Date.now(),name:names[1],text}];publish();},
    notice(message){socket?.send(JSON.stringify({type:'error',message}));},
    disconnect(){socket?.close({code:1012,reason:'local reconnect fixture'});socket=null;},
    legal(actor='p0'){return legal(game,actor);},
  };
}
