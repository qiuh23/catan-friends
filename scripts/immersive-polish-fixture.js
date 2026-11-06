import assert from 'node:assert/strict';
import {createGame,addPlayer,act,botAction,legal,viewFor,RESOURCES} from '../shared/game.js';

export const polishURL=process.env.TEST_URL||'http://127.0.0.1:5175';
export function polishGame(count=6,{phase='action'}={}){
  let seed=31+count;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  let game=createGame({playerExpansion:count>4?'five-six-2025':'base',friendlyRobber:true,harbormaster:true});
  for(let i=0;i<count;i++)addPlayer(game,`p${i}`,`海风玩家${i+1}`,i>0);
  for(const p of game.players)p.ready=true;
  if(phase==='lobby')return game;
  game=act(game,'p0',{type:'start'},random);
  if(phase==='setup-settlement')return game;
  while(game.phase.startsWith('setup-')){const actor=game.players[game.turn].id;game=act(game,actor,botAction(game,actor),random);}
  game.phase=phase;game.turn=0;game.primaryTurn=0;game.turnNo=1;
  for(const p of game.players)for(const resource of RESOURCES)p.hand[resource]=p.id==='p0'?4:2;
  for(const resource of RESOURCES)game.bank[resource]=(count>4?24:19)-game.players.reduce((n,p)=>n+p.hand[resource],0);
  if(phase==='discard')game.discards={p0:10};
  if(phase==='finished')game.winner='p0';
  return game;
}

// Real rules and privacy projections over a loopback WebSocket fixture. Room
// authority, durable persistence and bot timers are verified by protocol suites.
export async function openPolishFixture(browser,{count=6,phase='action',viewport={width:1366,height:768},touch=false,practice=false,me='p0',errors=[]}={}){
  const context=await browser.newContext({viewport,hasTouch:touch,isMobile:touch});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  let game=polishGame(count,{phase}),socket,revision=0,paused=false,chat=[];const actions=[];
  const project=()=>{
    const view=viewFor(game,me);
    assert.ok(view.players.filter(p=>p.id!==me).every(p=>!('hand'in p)&&!('dev'in p)));
    return {...view,chat,room:{hostId:'p0',paused,practice,visibility:'private',serverNow:Date.now(),retentionReason:practice?'practice':paused?'paused':'host-offline'},players:view.players.map(p=>({...p,online:true}))};
  };
  const publish=()=>socket?.send(JSON.stringify({type:'state',revision:++revision,state:project()}));
  await page.route('**/api/deployment',route=>route.fulfill({json:{game:'catan-friends',siteEdition:'global',backendId:'local',publicOrigin:new URL(polishURL).origin}}));
  await page.route('**/api/rooms',route=>route.fulfill({json:route.request().method()==='POST'?{code:'ABC234'}:{rooms:[]}}));
  await page.routeWebSocket('**/api/rooms/*/ws',ws=>{
    socket=ws;ws.onMessage(message=>{
      const envelope=JSON.parse(message);if(['hello','sync'].includes(envelope.type))return publish();
      if(envelope.type!=='action')return;actions.push(envelope.action);
      try{
        const action=envelope.action;
        if(action.type==='chat')chat.push({id:`chat-${revision}`,seq:chat.length+1,sentAt:Date.now(),name:'海风玩家1',text:action.text});
        else if(action.type==='pause'||action.type==='resume'){assert.equal(me,'p0');paused=action.type==='pause';}
        else if(action.type==='rematch'){assert.equal(me,'p0');assert.equal(game.phase,'finished');const players=game.players;game=createGame(game.options);for(const p of players)addPlayer(game,p.id,p.name,p.bot);paused=false;}
        else game=act(game,me,action,()=>.43);
        publish();ws.send(JSON.stringify({type:'ack',id:envelope.id}));
      }catch(error){ws.send(JSON.stringify({type:'error',id:envelope.id,message:error.message}));}
    });
  });
  await page.goto(polishURL);await page.locator('[data-action="openEntry"]').click();await page.locator('#nickname').fill('海风玩家1');await page.locator('#create-room').click();
  await page.locator('.in-room #board canvas[data-camera]').waitFor();await page.waitForTimeout(150);
  return {page,context,actions,publish,get game(){return game;},get paused(){return paused;},get state(){return project();},legal:(actor='p0')=>legal(game,actor),
    set(next){game=next;publish();},setPaused(value){paused=value;publish();},
    action(actor,action){game=act(game,actor,action,()=>.43);publish();return game.presentation?.events.at(-1);},
    chat(text){chat.push({id:`peer-${revision}`,seq:chat.length+1,sentAt:Date.now(),name:'海风玩家2',text});publish();},
  };
}
