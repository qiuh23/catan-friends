import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { toggleBoard, openStagePanel, closeStagePanel } from './browser-stage-helpers.js';

const url=process.env.TEST_URL||'http://127.0.0.1:5175',label=process.env.TEST_LABEL||'node';
let stage='starting';
const checkpoint=name=>{stage=name;console.log(`${label}: ${name}`);};
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})}),errors=[],contexts=[];
await mkdir('test-results',{recursive:true});
async function open(viewport={width:1440,height:960}) {
  const context=await browser.newContext({viewport});contexts.push(context);
  const page=await context.newPage(),client={context,page,state:null};
  page.on('pageerror',e=>errors.push(e.message));
  page.on('websocket',socket=>socket.on('framereceived',frame=>{try{const m=JSON.parse(frame.payload);if(m.type==='state')client.state=m.state;}catch{}}));
  client.wait=async predicate=>{for(let i=0;i<500;i++){if(client.state&&predicate(client.state))return;await new Promise(r=>setTimeout(r,20));}throw new Error(`Browser room state timeout (${client.state?.phase||'no state'}): ${(await page.locator('body').innerText()).slice(0,900)}`);};
  await page.goto(url);return client;
}
async function create(client,name,{visibility='public',options={}}={}) {
  await client.page.locator('#nickname').fill(name);await client.page.locator('#create-visibility').selectOption(visibility);
  if(Object.keys(options).length){for(const [key,value] of Object.entries(options)){if(key==='playerExpansion')await client.page.locator(`#create-count-${value==='five-six-2025'?6:4}`).check();else await client.page.locator(`#create-${key}`).setChecked(value);}}
  await client.page.getByRole('button',{name:'创建好友房间'}).click();await client.wait(s=>s.phase==='lobby');
  return new URL(client.page.url()).searchParams.get('room');
}
async function join(client,room,name){client.state=null;await client.page.goto(`${url}/?room=${room}`);await client.page.locator('#nickname').fill(name);await client.page.locator('#entry-form').getByRole('button',{name:'加入房间',exact:true}).click();await client.wait(s=>s.players.some(p=>p.id===s.me));}
async function confirm(client,name){await client.page.getByRole('button',{name,exact:true}).click();}
async function fit(client){assert.ok(await client.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`horizontal overflow: ${label}`);}
try {
  checkpoint('directory states');
  // A failed directory load remains distinct from an empty list and is retryable.
  const list=await open({width:390,height:844});let fail=true,paged=false,moreFails=true;
  await list.page.route('**/api/rooms*',route=>{
    if(route.request().method()!=='GET')return route.continue();
    if(fail)return route.fulfill({status:503,json:{error:'目录服务暂不可用'}});
    if(!paged)return route.fulfill({json:{rooms:[]}});
    const cursor=new URL(route.request().url()).searchParams.get('cursor');
    if(cursor&&moreFails)return route.fulfill({status:503,json:{error:'下一页暂不可用'}});
    return route.fulfill({json:{rooms:[{code:cursor?'DEF567':'ABC234',hostName:cursor?'第二页房主':'第一页房主',phase:'lobby',playerCount:1,maxPlayers:4}],nextCursor:cursor?null:'ABC234'}});
  });
  await list.page.reload();await list.page.getByRole('alert').filter({hasText:'连接失败'}).waitFor();fail=false;
  await list.page.getByRole('button',{name:'重试刷新'}).click();await list.page.getByText('还没有公开房间。创建一桌，邀请朋友来玩。').waitFor();await fit(list);
  paged=true;await list.page.getByRole('button',{name:'刷新',exact:true}).click();await list.page.getByRole('button',{name:'加载更多房间'}).click();
  await list.page.getByRole('alert').filter({hasText:'后续列表加载失败'}).waitFor();assert.equal(await list.page.locator('.public-room').count(),1);
  moreFails=false;await list.page.getByRole('button',{name:'重试加载更多'}).click();await list.page.getByText('房主 第二页房主 · 1 / 4 人').waitFor();
  assert.equal(await list.page.locator('.public-room').count(),2);assert.equal(await list.page.getByRole('button',{name:'加载更多房间'}).count(),0);
  await list.context.close();

  checkpoint('four humans joining');
  const host=await open(),peers=[await open(),await open(),await open()],observer=await open({width:390,height:844});
  const room=await create(host,'海风房主',{options:{friendlyRobber:true,harbormaster:true}});
  await observer.page.getByRole('button',{name:'刷新',exact:true}).click();await observer.page.locator('.public-room').filter({hasText:room}).waitFor();
  const publicRecord=(await (await fetch(`${url}/api/rooms`)).json()).rooms.find(r=>r.code===room);
  assert.ok(publicRecord);assert.ok(!JSON.stringify(publicRecord).match(/token|identities|hand|deck|dev\b/));
  for(const [i,peer] of peers.entries())await join(peer,room,`朋友${i+1}`);
  await host.wait(s=>s.players.length===4);await observer.page.getByRole('button',{name:'刷新',exact:true}).click();
  assert.equal(await observer.page.locator('.public-room').filter({hasText:room}).getByRole('button',{name:'已满'}).isDisabled(),true);
  await host.page.screenshot({path:`test-results/${label}-room-four-desktop.png`,fullPage:true});
  await host.page.setViewportSize({width:390,height:844});await fit(host);await host.page.screenshot({path:`test-results/${label}-room-four-mobile.png`,fullPage:true});

  checkpoint('leave, kick and transfer');
  const departedId=peers[2].state.me;
  await peers[2].page.getByRole('button',{name:'退出座位',exact:true}).click();await peers[2].page.getByText('以后可重新加入，原身份将失效。',{exact:false}).waitFor();await confirm(peers[2],'退出并返回');await host.wait(s=>s.players.length===3);
  assert.equal(await peers[2].page.evaluate(code=>JSON.parse(localStorage.getItem(`catan:token:${code}`)),room),null);
  await join(peers[2],room,'朋友3重入');await host.wait(s=>s.players.length===4);assert.notEqual(peers[2].state.me,departedId);
  await host.page.getByRole('button',{name:'移出玩家 朋友3重入'}).click();await confirm(host,'确认移出');
  await peers[2].page.getByText(/原身份已失效|移出/).first().waitFor();await host.wait(s=>s.players.length===3);
  await join(peers[2],room,'朋友3新身份');await host.wait(s=>s.players.length===4);

  await host.page.getByRole('button',{name:'转交房主给 朋友1'}).click();await confirm(host,'确认转交');
  await peers[0].wait(s=>s.room.hostId===s.me);await host.wait(s=>s.room.hostId!==s.me);
  assert.equal(await host.page.getByRole('button',{name:'解散房间',exact:true}).count(),0);
  for(const client of [host,peers[1],peers[2]]){await client.page.getByRole('button',{name:'我准备好了',exact:true}).click();await client.wait(s=>s.players.find(p=>p.id===s.me).ready);}
  checkpoint('four human setup');
  const owner=peers[0];await owner.wait(s=>s.players.every(p=>p.id===s.room.hostId||p.ready));
  await owner.page.getByRole('button',{name:'开始探索'}).click();await owner.wait(s=>s.phase==='setup-settlement');
  assert.equal(owner.state.targetPoints,11);assert.equal(owner.state.options.friendlyRobber,true);
  for(const client of [host,...peers])await toggleBoard(client.page,'切换二维棋盘');
  for(let i=0;i<16;i++){
    await owner.wait(s=>['setup-settlement','setup-road'].includes(s.phase));
    const phase=owner.state.phase,setup=owner.state.setupIndex,actor=owner.state.players[owner.state.turn].id;
    const current=[host,...peers].find(c=>c.state.me===actor);await current.wait(s=>s.phase===phase&&s.setupIndex===setup);
    await current.page.locator('#board [data-id]').first().click();await owner.wait(s=>s.phase!==phase||s.setupIndex!==setup);
  }
  await owner.wait(s=>s.phase==='roll');
  for(const client of [host,...peers])assert.ok(client.state.players.filter(p=>p.id!==client.state.me).every(p=>p.hand===undefined&&p.dev===undefined));
  assert.equal(await host.page.locator('#stage-dialog[open]').count(),0);
  await openStagePanel(host.page,'openChat');await host.page.locator('#chat-message').fill('暂存的交易想法');await closeStagePanel(host.page);
  await openStagePanel(owner.page,'openChat');await owner.page.locator('#chat-message').fill('一起开拓');await owner.page.getByRole('button',{name:'发送消息'}).click();
  await host.page.locator('.chat-unread').waitFor();
  await openStagePanel(host.page,'openChat');assert.equal(await host.page.locator('#chat-message').inputValue(),'暂存的交易想法');
  await closeStagePanel(host.page);await openStagePanel(owner.page,'openSettings');
  await owner.page.getByRole('button',{name:'转交房主',exact:true}).click();await owner.page.locator('#transfer-choice').selectOption(host.state.me);await confirm(owner,'确认转交');
  await host.wait(s=>s.room.hostId===s.me);assert.equal(await owner.page.getByRole('button',{name:'解散房间',exact:true}).count(),0);
  // Room management is reached directly from the floating settings button.
  await openStagePanel(host.page,'openSettings');
  await host.page.getByRole('button',{name:'转交房主',exact:true}).click();await host.page.locator('#transfer-choice').selectOption(owner.state.me);await confirm(host,'确认转交');
  await owner.wait(s=>s.room.hostId===s.me);
  checkpoint('pause deadline and closure');
  await openStagePanel(owner.page,'openSettings');
  await owner.page.getByRole('button',{name:'暂停对局',exact:true}).click();await confirm(owner,'确认暂停');await owner.wait(s=>s.room.paused);
  await openStagePanel(owner.page,'openSettings');await owner.page.getByRole('button',{name:'暂离房间',exact:true}).click();await confirm(owner,'暂离并返回');await host.wait(s=>s.room.expiresAt>0&&s.room.paused);
  const deadline=host.state.room.expiresAt,ownerId=owner.state.me;
  await openStagePanel(host.page,'openSettings');await host.page.locator('#room-retention').filter({hasText:'剩余'}).waitFor();await host.page.screenshot({path:`test-results/${label}-paused-countdown-mobile.png`,fullPage:true});
  owner.state=null;await owner.page.getByRole('button',{name:/原身份返回/}).first().click();await owner.wait(s=>s.me===ownerId&&s.room.paused);
  assert.equal(owner.state.room.expiresAt,deadline);await owner.page.getByRole('button',{name:'恢复对局',exact:true}).click();await owner.wait(s=>!s.room.paused);
  await openStagePanel(owner.page,'openSettings');await owner.page.getByRole('button',{name:'解散房间',exact:true}).click();await owner.page.getByText(/旧邀请、存档与重连都不能恢复/).waitFor();await confirm(owner,'确认解散');
  await host.page.getByText(/解散|关闭/).first().waitFor();assert.equal(await host.page.getByRole('button',{name:/原身份返回/}).count(),0);

  checkpoint('private and practice');
  const secret=await open();const privateRoom=await create(secret,'私密房主',{visibility:'private'});
  assert.ok(!(await (await fetch(`${url}/api/rooms`)).json()).rooms.some(r=>r.code===privateRoom));
  const practice=await open();await practice.page.locator('#nickname').fill('练习者');await practice.page.getByRole('button',{name:'人机练习',exact:true}).click();await practice.page.getByRole('button',{name:'开始练习',exact:false}).click();await practice.wait(s=>Boolean(s.board));
  const practiceRoom=new URL(practice.page.url()).searchParams.get('room');assert.ok(!(await (await fetch(`${url}/api/rooms`)).json()).rooms.some(r=>r.code===practiceRoom));
  await practice.page.setViewportSize({width:390,height:844});await fit(practice);await practice.page.screenshot({path:`test-results/${label}-practice-mobile.png`,fullPage:true});
  checkpoint('closing initial contexts');
  for(const context of contexts)await context.close();
  checkpoint('six humans joining');
  const six=[];for(let i=0;i<6;i++)six.push(await open());
  const sixRoom=await create(six[0],'扩充房主',{options:{playerExpansion:'five-six-2025',friendlyRobber:true,harbormaster:true}});
  for(let i=1;i<6;i++)await join(six[i],sixRoom,`扩充朋友${i}`);
  await six[0].wait(s=>s.players.length===6);assert.equal(six[0].state.maxPlayers,6);assert.equal(six[0].state.minPlayers,5);
  for(let i=1;i<6;i++){await six[i].page.getByRole('button',{name:'我准备好了',exact:true}).click();await six[i].wait(s=>s.players.find(p=>p.id===s.me).ready);}
  await six[0].page.screenshot({path:`test-results/${label}-room-six-desktop.png`,fullPage:true});
  await six[0].page.setViewportSize({width:390,height:844});await fit(six[0]);await six[0].page.screenshot({path:`test-results/${label}-room-six-mobile.png`,fullPage:true});
  await six[0].wait(s=>s.players.every(p=>p.id===s.room.hostId||p.ready));await six[0].page.getByRole('button',{name:'开始探索'}).click();await six[0].wait(s=>s.phase==='setup-settlement');
  checkpoint('six human setup');
  assert.equal(six[0].state.board.tiles.length,30);assert.equal(six[0].state.deckCount,34);assert.equal(new Set(six[0].state.players.map(p=>p.color)).size,6);
  await fit(six[0]);await six[0].page.screenshot({path:`test-results/${label}-six-board-3d-mobile.png`,fullPage:true});
  for(const client of six)await toggleBoard(client.page,'切换二维棋盘');
  for(let i=0;i<24;i++){
    const phase=six[0].state.phase,setup=six[0].state.setupIndex,actor=six[0].state.players[six[0].state.turn].id,current=six.find(c=>c.state.me===actor);
    await current.wait(s=>s.phase===phase&&s.setupIndex===setup);await current.page.locator('#board [data-id]').first().click();await six[0].wait(s=>s.phase!==phase||s.setupIndex!==setup);
  }
  await six[0].wait(s=>s.phase==='roll');await fit(six[0]);await six[0].page.screenshot({path:`test-results/${label}-six-board-2d-mobile.png`,fullPage:true});
  checkpoint('six paired stage');
  await six[0].page.getByRole('button',{name:'掷出骰子',exact:true}).click();await six[0].wait(s=>s.phase!=='roll');
  if(six[0].state.phase==='robber'){await six[0].page.locator('#board [data-tile][role="button"]').first().click();await six[0].wait(s=>s.phase!=='robber');}
  if(six[0].state.phase==='steal'){await six[0].page.locator('[data-victim]').first().click();await six[0].wait(s=>s.phase==='action');}
  await six[0].page.getByRole('button',{name:'结束回合'}).click();await six[3].wait(s=>s.pairStep==='secondary'&&s.turn===3&&s.phase==='action');
  await six[3].page.getByRole('button',{name:'资源交易',exact:true}).click();assert.equal(await six[3].page.locator('[data-action="publishTrade"]').isDisabled(),true);
  await six[3].page.getByText('配对建设阶段可使用银行／港口').waitFor();await six[3].page.locator('[data-trade-view="bank"]').click();assert.equal(await six[3].page.locator('[data-action="exchangeBank"]').count(),1);
  await closeStagePanel(six[3].page);
  await six[3].page.getByRole('button',{name:'结束阶段'}).click();await six[1].wait(s=>s.pairStep==='primary'&&s.turn===1&&s.phase==='roll');
  assert.deepEqual(errors,[]);
  console.log(`${label}: directory errors/empty/full/paging, private/practice exclusion, four/six human full setup and paired stage, leave/rejoin/revocation/kick/transfer, variants, pause deadline/recovery/close, folded chat/unread/draft, privacy, desktop/mobile passed.`);
} finally {await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,15000);browser.close().then(()=>{clearTimeout(timer);resolve();},error=>{clearTimeout(timer);reject(error);});});}
