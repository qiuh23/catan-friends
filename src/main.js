import './style.css';
import { Board, FlatBoard } from './board.js';
import { Connection } from './connection.js';
import { icon } from './icons.js';
import { newId } from './id.js';
import { readRoom, readInvitation, invitationURL, lobbyOrigins } from './invitation.js';
import { createBoard, RESOURCES, LABELS, emptyHand, total } from '../shared/board.js';
import { COSTS, DEV_NAMES, afford } from '../shared/game.js';

const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage={get(key){try{return JSON.parse(localStorage.getItem(`catan:${key}`));}catch{return null;}},set(key,value){try{localStorage.setItem(`catan:${key}`,JSON.stringify(value));}catch{}}};
let state=null,connection=null,code='',status='idle',busy=false,selectedBuild='',panel='',cardId='',flat=false,board;
let previewSeed=17;const preview={board:createBoard(()=>{previewSeed=(previewSeed*1664525+1013904223)>>>0;return previewSeed/4294967296;}),players:[],robber:null,legal:{}};
let backendId='local',invite='',entryError='';
try {
  const response=await fetch('/api/deployment',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('暂时无法确认当前服务器，请刷新后重试。');
  const deployment=await response.json();
  if(deployment.game!=='catan-friends'||!['local','aliyun','cloudflare'].includes(deployment.backendId)||deployment.publicOrigin&&deployment.publicOrigin!==location.origin)throw new Error('服务器配置与当前入口不一致，请联系维护者。');
  backendId=deployment.backendId;invite=readInvitation(location.search,backendId);
}catch(error){entryError=error.message;}
const displayCode=value=>backendId==='aliyun'?`A-${value}`:backendId==='cloudflare'?`C-${value}`:value;
const mine=()=>state?.players.find(p=>p.id===state.me);
const myTurn=()=>state && state.players[state.turn]?.id===state.me;
const ownRatio=r=>{const ports=state.board.ports.filter(p=>p.vertices.some(v=>state.board.vertices[v].owner===state.me));return ports.some(p=>p.resource===r)?2:ports.some(p=>p.resource==='any')?3:4;};
const resCost=cost=>Object.entries(cost).map(([r,n])=>`<span class="mini-resource ${r}" title="${LABELS[r]} ${n}">${icon(r)}${n}</span>`).join('');
const button=(text,action,disabled=false,cls='')=>`<button type="button" class="${cls}" data-action="${action}" ${disabled?'disabled':''}>${text}</button>`;
document.querySelector('#app').innerHTML=`
  <header class="topbar"><a class="brand" href="/" aria-label="卡坦岛好友桌首页"><span class="brand-mark">${icon('island')}</span><span>卡坦岛 <small>好友桌</small></span></a><div id="room-meta"></div><nav>${lobbyOrigins[backendId]?`<a class="text-button" href="${lobbyOrigins[backendId]}" aria-label="返回当前服务器游戏大厅">大厅</a>`:''}${button(`${icon('book')}<span>玩法指南</span>`,'rules',false,'text-button')}</nav></header>
  <main id="table" class="table home"><aside id="left-panel"></aside><section class="board-area" aria-label="游戏棋盘"><div id="board"></div><div class="board-top" id="turn-banner"></div><div class="board-controls">${button(icon('reset'),'reset',false,'square')}<button class="square" id="flat-toggle" type="button" aria-label="切换二维棋盘">2D</button></div><div id="tile-hint" class="tile-hint">拖动旋转 · 滚轮缩放</div><div id="hand"></div><div id="island-caption"></div></section><aside id="right-panel"></aside></main>
  <div id="toast" role="status" aria-live="polite"></div><dialog id="rules-dialog"><div class="dialog-heading"><h2>在岛上，建立你的世界。</h2>${button(icon('close'),'closeRules',false,'square')}</div><div class="rules-copy"><p>3–4 人经典基础版。轮到你时达到 <strong>10 个胜利点</strong>，即可获胜。</p><h3>先为自己找个好位置</h3><p>每人放置两座村庄与两条道路：第一轮顺序放置，第二轮反向放置。第二座村庄会收取相邻地块各 1 张资源。任意两座村庄之间必须至少隔一个空交叉点。</p><h3>掷骰、收获、交易、建造</h3><p>掷出两枚骰子，数字对应的地块向相邻村庄生产 1 张资源，向城市生产 2 张。所有玩家都可能收获。随后可多次交易、建造或购买发展卡，完成后结束回合。</p><div class="rules-costs">${Object.entries(COSTS).map(([k,c])=>`<div>${icon(k)}<b>${({road:'道路',settlement:'村庄',city:'城市',development:'发展卡'})[k]}</b>${resCost(c)}</div>`).join('')}</div><h3>强盗与七点</h3><p>掷出 7 时不生产资源。手牌超过 7 张的玩家须弃掉一半（向下取整）；当前玩家移动强盗，并从相邻的一名对手处随机抽一张资源。强盗所在格停止生产。</p><h3>把资源换成机会</h3><p>可向其他玩家提出交易，由对方接受。银行默认 4:1；拥有普通港口时 3:1，对应专属港口为 2:1。只能在自己的行动阶段主动发起交易。</p><h3>发展卡与额外得分</h3><p>每回合最多使用一张非胜利点发展卡，当回合购买的不能使用。骑士移动强盗；道路建设免费建造最多两条路；丰收从银行取两张资源；垄断收取所有对手的一种资源。胜利点卡私下自动计分。</p><p>村庄 1 分，城市 2 分。最长道路至少 5 段、最大骑士军队至少 3 张，各值 2 分；平手时原持有者保留。对手建筑会截断道路。</p><p class="muted">刷新页面会恢复原座位。断线时保留牌局，全部离线后电脑暂停行动。房间保留至最后活动后的 48 小时。</p></div></dialog>`;
document.querySelector('[data-action="rules"]').setAttribute('aria-label','玩法指南');
document.querySelector('[data-action="closeRules"]').setAttribute('aria-label','关闭玩法指南');
const resetButton=document.querySelector('[data-action="reset"]');resetButton.setAttribute('aria-label','复位棋盘视角');
function toast(text){const el=$('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),4500);}
function mode(){if(!state||!myTurn())return '';if(state.phase==='setup-settlement')return 'settlement';if(['setup-road','road-building'].includes(state.phase))return 'road';if(state.phase==='robber')return 'robber';return state.phase==='action'?selectedBuild:'';}
function makeBoard(){board?.dispose();$('#board').innerHTML='';try{board=flat?new FlatBoard($('#board'),select,hover):new Board($('#board'),select,hover);}catch(error){flat=true;board=new FlatBoard($('#board'),select,hover);toast('当前设备无法开启 3D，已切换到二维棋盘。');}$('#flat-toggle').textContent=flat?'3D':'2D';$('#flat-toggle').setAttribute('aria-label',flat?'切换三维棋盘':'切换二维棋盘');board.set(state?.board?state:preview,mode());}
function hover(text){$('#tile-hint').textContent=text|| (flat?'点击亮色标记落子':'拖动旋转 · 滚轮缩放');}
async function select(target){
  if(busy||status!=='connected')return;
  const m=mode();
  if(target.kind==='tile'&&m==='robber')return send({type:'moveRobber',tile:target.id});
  if(target.kind==='edge'&&m==='road')return send({type:'buildRoad',edge:target.id});
  if(target.kind==='vertex'&&['settlement','city'].includes(m))return send({type:m==='city'?'buildCity':'buildSettlement',vertex:target.id});
}
async function send(action){
  if(busy)return;busy=true;render();
  try{await connection.action(action);if(['buildRoad','buildCity','buildSettlement','playDevelopment'].includes(action.type)){selectedBuild='';panel='';cardId='';}}catch(error){toast(error.message);}finally{busy=false;render();}
}
function connect(room,token,name){
  if(entryError)return toast(entryError);
  try {room=readRoom(room,backendId);}catch(error){return toast(error.message);}
  connection?.close();code=room;state=null;status='connecting';
  storage.set('last',{code,token,name});storage.set(`token:${code}`,token);storage.set('name',name);history.replaceState(null,'',invitationURL(location.origin,code,backendId));
  connection=new Connection(code,token,name,(next)=>{const old=state;state=next;if(old?.turnNo!==next.turnNo||old?.phase!==next.phase){selectedBuild='';panel='';cardId='';}render();},s=>{status=s;render();},toast);
  render();
}
async function create(practice=false){
  if(entryError)return toast(entryError);
  const name=$('#nickname')?.value.trim();if(!name)return toast('先给自己起个昵称。');
  busy=true;render();const token=newId();
  try{const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,token,practice})});const data=await response.json();if(!response.ok)throw new Error(data.error);connect(data.code,token,name);}catch(error){toast(error.message);}finally{busy=false;render();}
}
function join(){if(entryError)return toast(entryError);const name=$('#nickname').value.trim();if(!name)return toast('先给自己起个昵称。');let room;try{room=readRoom($('#join-code').value,backendId);}catch(error){return toast(error.message);}connect(room,storage.get(`token:${room}`)||newId(),name);}
const statusText=()=>({idle:'',connecting:'正在连接',connected:'已连接',reconnecting:'正在重连',failed:'连接失败',replaced:'座位已在其他页面打开'})[status];
function playerList(){return `<div class="players">${state.players.map((p,i)=>`<div class="player ${state.phase!=='lobby'&&i===state.turn?'active':''} ${p.id===state.me?'self':''}"><span class="avatar" style="--player:${p.color}">${p.bot?icon('bot'):esc(p.name.slice(0,1))}</span><div class="player-info"><strong>${esc(p.name)}${p.id===state.me?'<small>你</small>':''}</strong><span>${state.phase==='lobby'?(i===0?'房主':p.ready?'已准备':'未准备'):`${p.cards} 张资源 · ${p.developmentCount} 张发展卡`}${!p.online?' · 离线':''}</span></div>${state.phase==='lobby'?(p.bot && state.players[0].id===state.me?`<button class="remove-bot" data-remove-bot="${p.id}" aria-label="移除 ${p.name}">×</button>`:`<span class="presence ${p.online?'online':''}"></span>`):`<div class="score"><b>${p.points}</b><small>分</small></div>`}</div>`).join('')}</div>`;}
function homePanel(){const last=storage.get('last'),disabled=busy||Boolean(entryError);return `${entryError?`<p class="entry-error" role="alert">${esc(entryError)} <a href="/">返回当前服务器首页</a></p>`:''}<div class="home-intro"><h1>一座岛屿，<br>无限可能。</h1><p>收获一片麦田，铺下一条新路。<br>和朋友们，一起从这里启程。</p></div><div class="game-facts"><span>${icon('users')}3–4 人</span><span>${icon('flag')}10 分获胜</span></div><form id="entry-form"><label for="nickname">你的昵称</label><input id="nickname" data-persist autocomplete="nickname" maxlength="16" placeholder="岛上的朋友怎么称呼你" value="${esc(storage.get('name')||'')}" required><button type="button" id="create-room" class="primary large" ${disabled?'disabled':''}>${busy?'正在准备岛屿…':'创建好友房间'}${icon('arrow')}</button><div class="join-row"><input id="join-code" data-persist aria-label="6 位房间码或带服务器前缀的邀请码" autocomplete="off" maxlength="8" placeholder="6 位房间码 / A-或C-前缀" value="${esc(invite?displayCode(invite):'')}"><button type="submit" ${disabled?'disabled':''}>加入房间</button></div></form><div class="practice-entry">${button(`${icon('bot')}先和电脑练一局`,'practice',disabled,'text-button')}<p>无需等人，完整体验一场对局。</p></div>${last?button(`返回房间 ${esc(last.code)} ${icon('arrow')}`,'resume',disabled,'resume-button'):''}<div class="home-bottom"><span>经典基础版</span><a href="https://github.com/Jack15678/catan-friends" target="_blank" rel="noopener noreferrer">原作 Jack15678 · 个人非商业娱乐</a></div>`;}
function lobbyPanel(){const host=state.players[0].id===state.me;return `<div class="panel-title"><h2>等朋友入座</h2><p>分享邀请链接，凑齐就开桌。</p></div><div class="invite-block"><span>房间码</span><strong>${displayCode(code)}</strong>${button(`${icon('link')}复制邀请链接`,'invite',false,'text-button')}</div>${playerList()}${state.players.length<4?`<div class="empty-seat">${icon('users')}还有 ${4-state.players.length} 个空位</div>`:''}<div class="lobby-actions">${host?button(`${icon('bot')}添加电脑玩家`,'addBot',busy||state.players.length>=4,'secondary'):button(mine().ready?`${icon('check')}已准备 · 取消`:'我准备好了','ready',busy,'primary')}${host?button(`开始探索 ${icon('arrow')}`,'start',busy||state.players.length<3||state.players.some((p,i)=>i>0&&!p.ready),'primary'):''}</div><p class="muted small">至少 3 人开局，电脑玩家也可以占位。其他真人玩家准备后，由房主开始。</p>${button(`${icon('back')}返回首页`,'home',false,'text-button')}`;}
function gamePanel(){
  const me=mine(),active=myTurn(),disabled=busy||status!=='connected';
  return `<div class="panel-heading"><h2>岛上的朋友</h2><span>目标 10 分</span></div>${playerList()}<div class="awards"><span>${icon('road')}最长道路 <b>${state.longest?esc(state.players.find(p=>p.id===state.longest).name):'待争夺'}</b></span><span>${icon('flag')}最大军队 <b>${state.army?esc(state.players.find(p=>p.id===state.army).name):'待争夺'}</b></span></div><section class="build-section"><div class="panel-heading"><h2>建设你的版图</h2></div>${['road','settlement','city','development'].map(k=>{
    const can=active&&state.phase==='action'&&afford(me.hand,COSTS[k])&&(k==='development'?state.deckCount>0:state.legal[k].length>0);
    return `<button type="button" class="build-button ${selectedBuild===k?'selected':''}" data-build="${k}" ${!can||disabled?'disabled':''}><span class="build-icon">${icon(k)}</span><span><b>${({road:'道路',settlement:'村庄',city:'城市',development:'发展卡'})[k]}</b><span class="cost">${resCost(COSTS[k])}</span></span>${k==='development'?`<small>${state.deckCount}</small>`:icon('arrow')}</button>`;
  }).join('')}</section><div class="turn-actions">${button(`${icon('trade')}资源交易`,'trade',disabled||!active||state.phase!=='action','secondary')}${state.phase==='roll'&&active?button(`${icon('dice')}掷出骰子`,'roll',disabled,'primary'):button(`结束回合 ${icon('arrow')}`,'endTurn',disabled||!active||state.phase!=='action','primary')}</div><div class="supply"><span>剩余棋子</span><b>${15-state.board.edges.filter(e=>e.owner===me.id).length} 路 · ${5-state.board.vertices.filter(v=>v.owner===me.id&&v.level===1).length} 村 · ${4-state.board.vertices.filter(v=>v.owner===me.id&&v.level===2).length} 城</b></div>`;
}
function field(r,prefix,max=19){return `<label class="resource-input ${r}" for="${prefix}-${r}"><span>${icon(r)}${LABELS[r]}</span><input data-persist id="${prefix}-${r}" type="number" inputmode="numeric" min="0" max="${max}" value="0" aria-label="${prefix==='discard'?'弃掉':prefix==='give'?'提供':prefix==='want'?'需要':'获取'}${LABELS[r]}数量"></label>`;}
function formBundle(prefix){return Object.fromEntries(RESOURCES.map(r=>[r,Number($(`#${prefix}-${r}`)?.value||0)]));}
function resourceOptions(selected){return RESOURCES.map(r=>`<option value="${r}" ${r===selected?'selected':''}>${LABELS[r]}</option>`).join('');}
function actionPanel(){
  if(state.phase==='discard'&&state.discards[state.me])return `<section class="choice-panel"><h2>放下 ${state.discards[state.me]} 张资源</h2><p>掷出了 7，你的手牌超过了 7 张。</p><form id="discard-form">${RESOURCES.map(r=>field(r,'discard',mine().hand[r])).join('')}<button class="primary" ${busy?'disabled':''}>确认弃牌</button></form></section>`;
  if(state.phase==='steal'&&myTurn())return `<section class="choice-panel"><h2>选择一位对手</h2><p>随机抽取对方的一张资源牌。</p>${state.legal.victims.map(id=>`<button class="secondary" data-victim="${id}">${esc(state.players.find(p=>p.id===id).name)} ${icon('arrow')}</button>`).join('')}</section>`;
  if(panel==='trade')return `<section class="choice-panel"><div class="panel-heading"><h2>交换资源</h2>${button(icon('close'),'closePanel',false,'square')}</div><form id="bank-form"><label for="bank-give">向银行提供</label><div class="bank-row"><select id="bank-give" data-persist>${resourceOptions('wood')}</select><b id="bank-ratio">4 : 1</b><select id="bank-want" data-persist aria-label="从银行获取">${resourceOptions('wheat')}</select></div><button class="primary" ${busy?'disabled':''}>确认银行交易</button></form><form id="trade-form"><h3>向朋友发起交易</h3><div class="offer-columns"><div><b>我提供</b>${RESOURCES.map(r=>field(r,'give',mine().hand[r])).join('')}</div><div><b>我需要</b>${RESOURCES.map(r=>field(r,'want')).join('')}</div></div><button class="secondary" ${busy?'disabled':''}>发布交易请求</button></form></section>`;
  if(panel==='development'&&cardId){const card=mine().dev.find(c=>c.id===cardId);if(!card)return '';return `<section class="choice-panel"><div class="panel-heading"><h2>${DEV_NAMES[card.type]}</h2>${button(icon('close'),'closePanel',false,'square')}</div><form id="development-form">${card.type==='plenty'?`<p>从银行选择共两张资源。</p>${RESOURCES.map(r=>field(r,'plenty',state.bank[r])).join('')}`:card.type==='monopoly'?`<label for="monopoly-resource">收取所有对手的哪种资源？</label><select id="monopoly-resource" data-persist>${resourceOptions('ore')}</select>`:`<p>${card.type==='knight'?'移动强盗，并从一位相邻对手手中抽一张资源。':'免费铺设两条道路，仍需连接自己的路网。'}</p>`}<button class="primary" ${busy?'disabled':''}>打出${DEV_NAMES[card.type]}</button></form></section>`;}
  return '';
}
function offer(){const o=state.offer;if(!o)return '';return `<section class="trade-offer"><h3>${esc(state.players.find(p=>p.id===o.from).name)} 想和你交易</h3><div><span>提供</span>${resCost(Object.fromEntries(Object.entries(o.give).filter(([,n])=>n)))}</div><div><span>需要</span>${resCost(Object.fromEntries(Object.entries(o.want).filter(([,n])=>n)))}</div>${o.from===state.me?button('取消交易','cancelTrade',busy,'secondary'):button('接受这笔交易','acceptTrade',busy||!afford(mine().hand,o.want),'primary')}</section>`;}
function rightPanel(){
  if(!state||state.phase==='lobby')return `<div class="island-guide"><span class="guide-mark">${icon('island')}</span><h2>从一座村庄开始</h2><p>森林、麦田、牧场、山丘与山脉。每一片土地，都藏着下一次扩张的机会。</p><div class="resource-legend">${RESOURCES.map(r=>`<span class="${r}">${icon(r)}${LABELS[r]}</span>`).join('')}</div><p class="guide-note">选择资源丰富的交叉点，<br>让你的第一座村庄落地。</p></div>`;
  return `${state.phase==='finished'?`<section class="winner"><span>${icon('flag')}</span><h2>${esc(state.players.find(p=>p.id===state.winner).name)}<br>赢得了这座岛！</h2><p>${state.players.find(p=>p.id===state.winner).points} 个胜利点</p>${state.players[0].id===state.me?button('再来一局','rematch',busy,'primary'):''}${button('返回首页','home',false,'secondary')}</section>`:''}${actionPanel()}${offer()}<section class="log-section"><div class="panel-heading"><h2>岛屿记事</h2><span>回合 ${state.turnNo||'准备'}</span></div><div class="activity-log" aria-live="polite">${state.log.slice(-18).map(l=>`<p>${esc(l.text)}</p>`).join('')}</div></section><section class="chat-section"><h2>围桌聊聊</h2><div class="chat-log">${state.chat.length?state.chat.slice(-12).map(c=>`<p><strong>${esc(c.name)}</strong> ${esc(c.text)}</p>`).join(''):'<p class="muted">和朋友打声招呼，或聊聊交易。</p>'}</div><form id="chat-form"><input id="chat-message" data-persist maxlength="200" placeholder="说点什么…" aria-label="聊天消息"><button class="square" aria-label="发送消息" ${busy?'disabled':''}>${icon('arrow')}</button></form></section>`;
}
function banner(){
  if(!state||state.phase==='lobby')return '';
  const p=state.players[state.turn],self=myTurn();
  const descriptions={ 'setup-settlement':'选择一个亮色交叉点，建造村庄','setup-road':'选择与新村庄相连的道路',roll:'掷出骰子，看看岛屿的收获',action:selectedBuild?`点击亮色标记，建造${{road:'道路',settlement:'村庄',city:'城市'}[selectedBuild]}`:'交易、建设，让你的版图更进一步',discard:'等待手牌超过 7 张的玩家弃牌',robber:'点击一块新的土地，移动强盗',steal:'选择一位相邻对手，抽取资源','road-building':`还可以免费铺设 ${state.freeRoads} 条道路`,finished:'对局已结束，感谢这一次相聚'};
  return `<div class="turn-banner ${self?'your-turn':''}"><span class="turn-dot" style="background:${p.color}"></span><div><strong>${state.phase==='finished'?'岛屿已迎来胜者':self?'轮到你了':`等待 ${esc(p.name)}`}</strong><span>${descriptions[state.phase]||''}</span></div>${state.dice?`<div class="dice-pair" aria-label="骰子 ${state.dice.join(' 加 ')}">${state.dice.map(n=>`<span>${n}</span>`).join('')}</div>`:icon(self?'flag':'users')}</div>`;
}
function hand(){if(!state?.board)return '';return `<div class="hand-tray"><div class="hand-label"><strong>你的资源</strong><span>${total(mine().hand)} 张手牌</span></div><div class="resource-hand">${RESOURCES.map(r=>`<div class="resource-card ${r}" title="${LABELS[r]}：${mine().hand[r]} 张，银行剩余 ${state.bank[r]} 张"><span class="resource-art">${icon(r)}</span><span>${LABELS[r]}</span><strong>${mine().hand[r]}</strong></div>`).join('')}</div><div class="development-hand">${mine().dev.map(c=>`<button data-card="${c.id}" ${busy||!myTurn()||!['roll','action'].includes(state.phase)||state.playedDev||c.type==='victory'||c.bought>=state.turnNo?'disabled':''} title="${c.type==='victory'?'私下自动计入胜利点':c.bought>=state.turnNo?'本回合购入，下回合可用':'打出这张发展卡'}">${icon(c.type==='knight'?'flag':'development')}${DEV_NAMES[c.type]}${c.bought>=state.turnNo&&c.type!=='victory'?'<small>新</small>':''}</button>`).join('')}</div></div>`;}
function render(){
  const inputs=new Map([...document.querySelectorAll('[data-persist]')].map(el=>[el.id,el.value])),active=document.activeElement?.id,start=document.activeElement?.selectionStart;
  $('#table').className=`table ${state?'in-room':'home'} ${state?.board?'playing':''}`;
  $('#room-meta').innerHTML=code?`<span class="connection ${status}"><i></i>${statusText()}</span><span class="room-code">房间 ${displayCode(code)}</span>${button(`${icon('link')}<span>邀请好友</span>`,'invite',false,'text-button')}${state?.board?button(icon('back'),'home',false,'square'):''}`:'<span class="header-note">把朋友聚在一张桌上</span>';
  $('#left-panel').innerHTML=state?(state.phase==='lobby'?lobbyPanel():gamePanel()):homePanel();
  $('#right-panel').innerHTML=rightPanel();$('#turn-banner').innerHTML=banner();$('#hand').innerHTML=hand();
  document.querySelector('#room-meta [data-action="home"]')?.setAttribute('aria-label','返回首页');
  document.querySelector('[data-action="closePanel"]')?.setAttribute('aria-label','关闭操作面板');
  $('#island-caption').innerHTML=state?.board?'':`<span>一场新的冒险，正等着你。</span><strong>卡坦岛</strong><span>探索 · 交易 · 建设</span>`;
  for(const [id,value] of inputs){const el=document.getElementById(id);if(el)el.value=value;}
  if(active){const el=document.getElementById(active);if(el){el.focus({preventScroll:true});if(start!=null && ['text','search'].includes(el.type))try{el.setSelectionRange(start,start);}catch{}}}
  board?.set(state?.board?state:preview,mode());
  for(const el of document.querySelectorAll('.activity-log,.chat-log'))el.scrollTop=el.scrollHeight;
  bindForms();updateRatio();
}
function updateRatio(){if($('#bank-ratio'))$('#bank-ratio').textContent=`${ownRatio($('#bank-give').value)} : 1`;}
function bindForms(){
  if($('#entry-form'))$('#entry-form').onsubmit=e=>{e.preventDefault();join();};if($('#create-room'))$('#create-room').onclick=()=>create();
  if($('#discard-form'))$('#discard-form').onsubmit=e=>{e.preventDefault();send({type:'discard',cards:formBundle('discard')});};
  if($('#bank-form'))$('#bank-form').onsubmit=e=>{e.preventDefault();send({type:'bankTrade',give:$('#bank-give').value,want:$('#bank-want').value});};
  if($('#bank-give'))$('#bank-give').onchange=updateRatio;
  if($('#trade-form'))$('#trade-form').onsubmit=e=>{e.preventDefault();send({type:'offerTrade',give:formBundle('give'),want:formBundle('want')});};
  if($('#chat-form'))$('#chat-form').onsubmit=e=>{e.preventDefault();const el=$('#chat-message'),text=el.value.trim();if(text){el.value='';send({type:'chat',text});}};
  if($('#development-form'))$('#development-form').onsubmit=e=>{e.preventDefault();send({type:'playDevelopment',cardId,cards:formBundle('plenty'),resource:$('#monopoly-resource')?.value});};
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.build){if(b.dataset.build==='development')return send({type:'buyDevelopment'});selectedBuild=selectedBuild===b.dataset.build?'':b.dataset.build;panel='';return render();}
  if(b.dataset.removeBot)return send({type:'removeBot',playerId:b.dataset.removeBot});
  if(b.dataset.victim)return send({type:'steal',victim:b.dataset.victim});
  if(b.dataset.card){cardId=b.dataset.card;panel='development';return render();}
  const action=b.dataset.action;
  if(['start','ready','addBot','roll','endTurn','cancelTrade','rematch'].includes(action))return send({type:action});
  if(action==='acceptTrade')return send({type:'acceptTrade',offerId:state.offer.id});
  if(action==='rules')return $('#rules-dialog').showModal();if(action==='closeRules')return $('#rules-dialog').close();
  if(action==='reset')return board.reset();
  if(action==='practice')return create(true);
  if(action==='trade'){panel=panel==='trade'?'':'trade';selectedBuild='';render();return;}
  if(action==='closePanel'){panel='';return render();}
  if(action==='resume'){const last=storage.get('last');if(last)connect(last.code,last.token,last.name);return;}
  if(action==='home'){connection?.close();connection=null;state=null;code='';status='idle';selectedBuild='';panel='';history.replaceState(null,'','/');render();return;}
  if(action==='invite'){const link=invitationURL(location.origin,code,backendId);try{await navigator.clipboard.writeText(link);toast('邀请链接已复制，发给朋友即可加入。');}catch{toast(`房间码：${displayCode(code)}。将当前页面地址发给朋友即可。`);}return;}
  if(b.id==='flat-toggle'){flat=!flat;makeBoard();}
});
makeBoard();render();
const last=storage.get('last');if(!entryError&&invite&&last?.code===invite)connect(last.code,last.token,last.name);
window.addEventListener('online',()=>{if(connection&&!connection.stopped&&connection.ws.readyState>1){clearTimeout(connection.reconnectTimer);connection.connect();}});
