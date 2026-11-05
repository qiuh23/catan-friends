import './style.css';
import { Board, FlatBoard } from './board.js';
import { Connection } from './connection.js';
import { icon, resourceIllustration } from './icons.js';
import { newId } from './id.js';
import { readRoom, readInvitation, invitationURL, lobbyOrigins } from './invitation.js';
import { createBoard, RESOURCES, LABELS, emptyHand, total } from '../shared/board.js';
import { COSTS, DEV_NAMES, afford } from '../shared/game.js';
import { variantOptions, rulesLabel, roomAvailability, remainingTime, gameLobbyURL, leaveDescription, mergeRoomPages } from './room-ui.js';

const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage={get(key){try{return JSON.parse(localStorage.getItem(`catan:${key}`));}catch{return null;}},set(key,value){try{localStorage.setItem(`catan:${key}`,JSON.stringify(value));}catch{}}};
let state=null,connection=null,code='',status='idle',busy=false,selectedBuild='',panel='',cardId='',flat=false,board;
let seenChatIds=new Set();
let roomList={status:'loading',rooms:[],error:'',nextCursor:null,moreStatus:'idle',moreError:''},listRequest=0,terminalMessage='',receivedAt=Date.now(),confirmation=null;
let previewSeed=17;const preview={board:createBoard(()=>{previewSeed=(previewSeed*1664525+1013904223)>>>0;return previewSeed/4294967296;}),players:[],robber:null,legal:{}};
let backendId='local',invite='',entryError='';
try {
  const response=await fetch('/api/deployment',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('暂时无法确认当前服务器，请刷新后重试。');
  const deployment=await response.json();
  if(deployment.game!=='catan-friends'||!['local','aliyun','cloudflare'].includes(deployment.backendId)||deployment.publicOrigin&&deployment.publicOrigin!==location.origin)throw new Error('服务器配置与当前入口不一致，请联系维护者。');
  backendId=deployment.backendId;invite=readInvitation(location.search,backendId);
}catch(error){entryError=error.message;roomList={...roomList,status:'error',error:'入口校验未通过，无法读取当前服务器房间列表。'};}
const displayCode=value=>backendId==='aliyun'?`A-${value}`:backendId==='cloudflare'?`C-${value}`:value;
const mine=()=>state?.players.find(p=>p.id===state.me);
const myTurn=()=>state && state.players[state.turn]?.id===state.me;
const ownRatio=r=>{const ports=state.board.ports.filter(p=>p.vertices.some(v=>state.board.vertices[v].owner===state.me));return ports.some(p=>p.resource===r)?2:ports.some(p=>p.resource==='any')?3:4;};
const resCost=cost=>Object.entries(cost).map(([r,n])=>`<span class="mini-resource ${r}" title="${LABELS[r]} ${n}">${icon(r)}${n}</span>`).join('');
const button=(text,action,disabled=false,cls='')=>`<button type="button" class="${cls}" data-action="${action}" ${disabled?'disabled':''}>${text}</button>`;
document.querySelector('#app').innerHTML=`
  <header class="topbar"><a class="brand" data-home-link href="/" aria-label="卡坦岛好友桌首页"><span class="brand-mark">${icon('island')}</span><span>卡坦岛 <small>好友桌</small></span></a><div id="room-meta"></div><nav>${lobbyOrigins[backendId]?`<a class="text-button" data-lobby-link href="${lobbyOrigins[backendId]}" aria-label="返回当前服务器游戏大厅">返回游戏大厅</a>`:''}${button(`${icon('book')}<span>玩法指南</span>`,'rules',false,'text-button')}</nav></header>
  <main id="table" class="table home"><aside id="left-panel"></aside><section class="board-area" aria-label="游戏棋盘"><div id="board"></div><div class="board-top" id="turn-banner"></div><div class="board-controls">${button(icon('reset'),'reset',false,'square')}<button class="square" id="flat-toggle" type="button" aria-label="切换二维棋盘">2D</button></div><div id="tile-hint" class="tile-hint">拖动旋转 · 滚轮缩放</div><div id="hand"></div><div id="island-caption"></div></section><aside id="right-panel"></aside></main>
  <dialog id="room-dialog" aria-labelledby="room-dialog-title"><div class="dialog-heading"><h2 id="room-dialog-title"></h2>${button(icon('close'),'cancelRoomDialog',false,'square')}</div><p id="room-dialog-copy"></p><div class="dialog-actions">${button('取消','cancelRoomDialog',false,'secondary')}${button('确认','confirmRoomDialog',false,'primary')}</div></dialog><div id="toast" role="status" aria-live="polite"></div><dialog id="rules-dialog"><div class="dialog-heading"><h2>在岛上，建立你的世界。</h2>${button(icon('close'),'closeRules',false,'square')}</div><div class="rules-copy"><p>经典基础版为 3–4 人；5–6 人扩充采用大岛屿与 2025 配对回合。基础版默认达到 <strong>10 个胜利点</strong>获胜。可选拓展在建房时选择，开局前由房主调整，规则对所有人公开。</p><h3>先为自己找个好位置</h3><p>每人放置两座村庄与两条道路：第一轮顺序放置，第二轮反向放置。第二座村庄会收取相邻地块各 1 张资源。任意两座村庄之间必须至少隔一个空交叉点。</p><h3>掷骰、收获、交易、建造</h3><p>掷出两枚骰子，数字对应的地块向相邻村庄生产 1 张资源，向城市生产 2 张。所有玩家都可能收获。随后可多次交易、建造或购买发展卡，完成后结束回合。</p><div class="rules-costs">${Object.entries(COSTS).map(([k,c])=>`<div>${icon(k)}<b>${({road:'道路',settlement:'村庄',city:'城市',development:'发展卡'})[k]}</b>${resCost(c)}</div>`).join('')}</div><h3>强盗与七点</h3><p>掷出 7 时不生产资源。手牌超过 7 张的玩家须弃掉一半（向下取整）；当前玩家移动强盗，并从相邻的一名对手处随机抽一张资源。强盗所在格停止生产。</p><h3>把资源换成机会</h3><p>可向其他玩家提出交易，由对方接受。银行默认 4:1；拥有普通港口时 3:1，对应专属港口为 2:1。只能在自己的行动阶段主动发起交易。</p><h3>发展卡与额外得分</h3><p>每回合最多使用一张非胜利点发展卡，当回合购买的不能使用。骑士移动强盗；道路建设免费建造最多两条路；丰收从银行取两张资源；垄断收取所有对手的一种资源。胜利点卡私下自动计分。</p><p>村庄 1 分，城市 2 分。最长道路至少 5 段、最大骑士军队至少 3 张，各值 2 分；平手时原持有者保留。对手建筑会截断道路。</p><h3>可选拓展（2025 规则）</h3><p><strong>友善强盗：</strong>公开分不超过 2 分的玩家，其建筑相邻地块不能放置强盗；掷出 7 仍正常弃牌。<strong>卡坦港口：</strong>港口村庄计 1 港口分、城市计 2 分，首达 3 港口分取得 2 胜利分奖励，严格超过现持有者时转交。启用后目标为 11 胜利分。两项变体均可组合，人数由所选基础版或 5–6 人扩充决定。</p><h3>5–6 人扩充 · 2025 配对回合</h3><p>每个常规回合由主玩家掷骰并行动，之后由相隔三席的配对伙伴进行一次建设阶段。伙伴可以银行与港口交易、建设、购买和使用发展卡并获胜，不能再次掷骰或与其他玩家交易。伙伴结束后轮到下一位主玩家掷骰。本模式使用扩大的岛屿、资源与发展卡供应。</p><h3>暂离、暂停与房间保留</h3><p class="muted">普通真人房从房主最后一个有效连接离线起保留 30 分钟。房主主动暂停的真人房，从本次暂停首次离线起固定保留最多 4 小时，短暂重连不延长截止时间。练习房离开后保留 10 分钟。房主在线时不会因普通闲置关闭。对局中暂离保留身份；等待阶段非房主主动退座释放席位。解散由房主单独确认。</p></div></dialog>`;
document.querySelector('[data-action="rules"]').setAttribute('aria-label','玩法指南');
document.querySelector('[data-action="cancelRoomDialog"]').setAttribute('aria-label','关闭房间确认');
document.querySelector('[data-action="closeRules"]').setAttribute('aria-label','关闭玩法指南');
const resetButton=document.querySelector('[data-action="reset"]');resetButton.setAttribute('aria-label','复位棋盘视角');
function toast(text){const el=$('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),4500);}
function mode(){if(!state||!myTurn()||state.room?.paused)return '';if(state.phase==='setup-settlement')return 'settlement';if(['setup-road','road-building'].includes(state.phase))return 'road';if(state.phase==='robber')return 'robber';return state.phase==='action'?selectedBuild:'';}
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
  try{await connection.action(action);if(['buildRoad','buildCity','buildSettlement','playDevelopment'].includes(action.type)){selectedBuild='';panel='';cardId='';}return true;}catch(error){toast(error.message);return false;}finally{busy=false;render();}
}
function connect(room,token,name){
  if(entryError)return toast(entryError);
  try {room=readRoom(room,backendId);}catch(error){return toast(error.message);}
  connection?.close();code=room;state=null;seenChatIds=new Set();status='connecting';
  terminalMessage='';storage.set('name',name);history.replaceState(null,'',invitationURL(location.origin,code,backendId));
  connection=new Connection(code,token,name,(next)=>{const old=state;receivedAt=Date.now();if(next.room?.closed)return terminal({type:'closed',message:next.room.closeReason||'房间已关闭。'});state=next;storage.set('last',{code,token,name});storage.set(`token:${code}`,token);if(old?.turnNo!==next.turnNo||old?.phase!==next.phase){selectedBuild='';panel='';cardId='';}render();},s=>{status=s;render();},toast,terminal);
  render();
}
async function create(practice=false){
  if(entryError)return toast(entryError);
  const name=$('#nickname')?.value.trim();if(!name)return toast('先给自己起个昵称。');
  const visibility=$('#create-visibility')?.value||'public',options=readOptions('create');
  busy=true;render();const token=newId();
  try{const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,token,practice,visibility:practice?'private':visibility,options})});const data=await response.json();if(!response.ok)throw new Error(data.error);connect(data.code,token,name);}catch(error){toast(error.message);}finally{busy=false;render();}
}
function join(){if(entryError)return toast(entryError);const name=$('#nickname').value.trim();if(!name)return toast('先给自己起个昵称。');let room;try{room=readRoom($('#join-code').value,backendId);}catch(error){return toast(error.message);}connect(room,storage.get(`token:${room}`)||newId(),name);}
const statusText=()=>({idle:'',connecting:'正在连接',connected:'已连接',reconnecting:'正在重连',failed:'连接失败',replaced:'座位已在其他页面打开'})[status];
const isHost=()=>state?.me===(state?.room?.hostId||state?.players[0]?.id);
const readOptions=prefix=>({...Object.fromEntries(variantOptions.map(v=>[v.key,Boolean($(`#${prefix}-${v.key}`)?.checked)])),playerExpansion:$(`#${prefix}-playerExpansion`)?.value||'base'});
const maxPlayers=()=>state?.maxPlayers||state?.profile?.maxPlayers||state?.room?.maxPlayers||4;
const minPlayers=()=>state?.minPlayers||state?.profile?.minPlayers||state?.room?.minPlayers||3;
function optionsFields(prefix,options={}){return `<fieldset class="rules-options"><legend>人数与玩法</legend><label for="${prefix}-playerExpansion">人数规则</label><select id="${prefix}-playerExpansion" data-persist><option value="base" ${options.playerExpansion!=='five-six-2025'?'selected':''}>基础版 · 3–4 人</option><option value="five-six-2025" ${options.playerExpansion==='five-six-2025'?'selected':''}>5–6 人扩充 · 2025 配对回合</option></select><p class="muted small">扩充采用大岛屿与配对建设；默认基础版。下面两项变体可单选或组合。</p>${variantOptions.map(v=>`<label class="variant-option" for="${prefix}-${v.key}"><input id="${prefix}-${v.key}" data-persist type="checkbox" ${options[v.key]?'checked':''}><span><b>${v.name}</b><small>${v.description}</small></span></label>`).join('')}</fieldset>`;}
function roomSettings(){return `<details id="room-settings-details" class="room-settings"><summary>${isHost()?'房间与玩法设置':'本桌玩法'}</summary><p class="rules-summary">${esc(rulesLabel(state.options))} · ${state.targetPoints||10} 分获胜</p>${isHost()?`<form id="room-settings-form"><label for="room-visibility">房间可见性</label><select id="room-visibility" data-persist><option value="public" ${state.room?.visibility!=='private'?'selected':''}>公开 · 出现在在线列表</option><option value="private" ${state.room?.visibility==='private'?'selected':''}>私密 · 仅邀请码加入</option></select>${optionsFields('room',state.options)}<button class="secondary" ${busy||status!=='connected'?'disabled':''}>保存设置 · 全员重新准备</button></form>`:''}</details>`;}
function playerList(){return `<div class="players">${state.players.map((p,i)=>`<div class="player ${state.phase!=='lobby'&&i===state.turn?'active':''} ${p.id===state.me?'self':''}"><span class="avatar" style="--player:${p.color}">${p.bot?icon('bot'):esc(p.name.slice(0,1))}</span><div class="player-info"><strong>${esc(p.name)}${p.id===state.me?'<small>你</small>':''}${p.id===(state.room?.hostId||state.players[0]?.id)?'<small>房主</small>':''}</strong><span>${state.phase==='lobby'?(p.bot?'电脑已准备':p.id===(state.room?.hostId||state.players[0]?.id)?'主持开局':p.ready?'已准备':'未准备'):`${p.cards} 张资源 · ${p.developmentCount} 张发展卡`}${!p.online?' · 离线':''}</span>${state.options?.harbormaster&&state.phase!=='lobby'?`<span>港口分 ${p.harborPoints||0}</span>`:''}</div>${state.phase==='lobby'?(isHost()&&p.id!==state.me?`<div class="player-management">${p.bot?`<button class="remove-bot" data-remove-bot="${p.id}" aria-label="移除电脑 ${esc(p.name)}">×</button>`:`<button data-transfer="${p.id}" aria-label="转交房主给 ${esc(p.name)}" ${!p.online?'disabled':''}>转交</button><button data-kick="${p.id}" aria-label="移出玩家 ${esc(p.name)}">移出</button>`}</div>`:`<span class="presence ${p.online?'online':''}"></span>`):`<div class="score"><b>${p.points}</b><small>分</small></div>`}</div>`).join('')}</div>`;}
function homePanel(){const last=storage.get('last'),disabled=busy||Boolean(entryError);return `${entryError?`<p class="entry-error" role="alert">${esc(entryError)} <a href="/">返回当前服务器首页</a></p>`:''}${terminalMessage?`<p class="room-outcome" role="status">${esc(terminalMessage)}</p>`:''}<div class="home-intro"><h1>一起，开拓<br>这座岛。</h1><p>与朋友围桌，展开新的冒险。</p></div><div class="game-facts"><span>${icon('users')}基础 3–4 人 · 扩充 5–6 人</span><span>${icon('flag')}基础版 10 分</span></div><form id="entry-form"><label for="nickname">你的昵称</label><input id="nickname" data-persist autocomplete="nickname" maxlength="16" placeholder="岛上的朋友怎么称呼你" value="${esc(storage.get('name')||'')}" required><div class="join-row"><input id="join-code" data-persist aria-label="6 位房间码或带服务器前缀的邀请码" autocomplete="off" maxlength="8" placeholder="6 位房间码 / A-或C-前缀" value="${esc(invite?displayCode(invite):'')}"><button type="submit" ${disabled?'disabled':''}>加入房间</button></div><label for="create-visibility">创建房间</label><select id="create-visibility" data-persist><option value="public">公开 · 出现在在线房间列表</option><option value="private">私密 · 仅邀请码加入</option></select><details id="create-options-details" class="create-options"><summary>基础版与可选拓展</summary>${optionsFields('create')}</details><button type="button" id="create-room" class="primary large" ${disabled?'disabled':''}>${busy?'正在准备岛屿…':'创建好友房间'}${icon('arrow')}</button></form><div class="practice-entry">${button(`${icon('bot')}先和电脑练一局`,'practice',disabled,'text-button')}<p>个人练习 · 不公开</p></div>${last?button(`原身份返回 ${esc(displayCode(last.code))} ${icon('arrow')}`,'resume',disabled,'resume-button'):''}<div class="home-bottom"><span>基础规则 · 可选拓展</span><a href="https://github.com/Jack15678/catan-friends" target="_blank" rel="noopener noreferrer">原作 Jack15678 · 个人非商业娱乐</a></div>`;}
function publicRooms(){return `<section class="public-rooms" aria-labelledby="public-rooms-title"><div class="panel-heading"><h2 id="public-rooms-title">在线房间</h2>${button(`${icon('reset')}刷新`,'refreshRooms',roomList.status==='loading'||Boolean(entryError),'text-button')}</div><p class="muted small">本服公开房 · 私密与练习不展示</p><div id="public-room-results" aria-live="polite" aria-busy="${roomList.status==='loading'}">${roomList.status==='loading'?'<p class="list-message">正在加载在线房间…</p>':roomList.status==='error'?`<p class="list-message list-error" role="alert">连接失败：${esc(roomList.error)}</p>${button('重试刷新','refreshRooms',false,'secondary')}`:!roomList.rooms.length?'<p class="list-message">还没有公开房间。创建一桌，邀请朋友来玩。</p>':roomList.rooms.map(room=>{const canReturn=Boolean(storage.get(`token:${room.code}`)),a=roomAvailability(room,canReturn);return `<article class="public-room"><div><strong>房间 ${esc(displayCode(room.code))}</strong><span class="room-status ${room.phase==='lobby'?'waiting':''}">${room.phase==='finished'?'已结束':room.status==='paused'?'已暂停':room.playerCount>=room.maxPlayers?'已满':room.phase==='lobby'?'等待入座':'进行中'}</span></div><p>房主 ${esc(room.hostName)} · ${room.playerCount} / ${room.maxPlayers} 人</p><small>${esc(rulesLabel(room.options))}</small><button class="${canReturn?'secondary':'primary'}" data-list-room="${esc(room.code)}" aria-label="${a.label==='加入房间'?'加入房间 '+esc(displayCode(room.code)):a.label}" ${a.disabled||entryError?'disabled':''}>${a.label}</button></article>`;}).join('')}</div>${roomList.moreError?`<p class="list-message list-error" role="alert">后续列表加载失败：${esc(roomList.moreError)}，已加载的房间仍保留。</p>`:''}${roomList.nextCursor?button(roomList.moreStatus==='loading'?'正在加载…':roomList.moreError?'重试加载更多':'加载更多房间','loadMoreRooms',roomList.moreStatus==='loading'||roomList.status==='loading','load-more secondary'):''}</section>`;}
async function refreshRooms(append=false){
  if(entryError||append&&(!roomList.nextCursor||roomList.moreStatus==='loading'))return;
  const request=++listRequest,cursor=append?roomList.nextCursor:null;
  roomList={...roomList,status:append?roomList.status:'loading',moreStatus:append?'loading':'idle',moreError:''};render();
  try{
    const response=await fetch(`/api/rooms${cursor?'?cursor='+encodeURIComponent(cursor):''}`,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'服务器暂不可用。');
    if(!Array.isArray(result.rooms))throw new Error('列表响应不完整，请重试。');if(request!==listRequest)return;
    roomList={status:'ready',rooms:append?mergeRoomPages(roomList.rooms,result.rooms):result.rooms,error:'',nextCursor:typeof result.nextCursor==='string'?result.nextCursor:null,moreStatus:'idle',moreError:''};
  }catch(error){
    if(request!==listRequest)return;
    roomList=append?{...roomList,moreStatus:'error',moreError:error.message}:{status:'error',rooms:[],error:error.message,nextCursor:null,moreStatus:'idle',moreError:''};
  }
  render();
}
function retention(){const room=state?.room;if(!room)return '';const remaining=remainingTime(room.expiresAt,room.serverNow,receivedAt);return `<section class="retention-notice ${remaining?'has-deadline':''}" role="status"><strong>${room.paused?'房主已暂停对局':room.practice?'个人练习房':room.visibility==='private'?'私密房间':'公开房间'}</strong><p id="room-retention">${remaining?`${room.retentionReason==='paused'||room.paused?'本次暂停固定期限':'房主离线保留'} · 剩余 ${remaining}，到期后房间关闭并清理。`:room.paused?'等待房主恢复。首次离线后固定保留最多 4 小时。':'房主在线时保留房间；对局中断线可用原身份返回。'}</p></section>`;}
function roomNavigation(){return `<div class="room-navigation">${isHost()&&state.phase!=='lobby'&&state.phase!=='finished'&&!state.room?.practice?button(state.room?.paused?'恢复对局':'暂停对局',state.room?.paused?'resumeGame':'pauseGame',busy||status!=='connected','secondary'):''}${isHost()&&state.phase!=='lobby'&&!state.room?.practice&&state.players.some(p=>p.id!==state.me&&!p.bot&&p.online)?button('转交房主','transferMenu',busy,'text-button'):''}${button(state.phase==='lobby'&&!isHost()?'退出座位':'暂离房间','home',busy,'text-button')}${isHost()?button('解散房间','dissolve',busy||status!=='connected','danger-button'):''}</div>`;}
function lobbyPanel(){const host=isHost();return `<div class="panel-title"><h2>等朋友入座</h2><p>分享邀请链接，凑齐就开桌。</p></div><div class="invite-block"><span>房间码 · ${state.room?.visibility==='private'?'私密':'公开'}</span><strong>${displayCode(code)}</strong>${button(`${icon('link')}复制邀请链接`,'invite',false,'text-button')}</div>${retention()}${playerList()}${state.players.length<maxPlayers()?`<div class="empty-seat">${icon('users')}还有 ${maxPlayers()-state.players.length} 个空位</div>`:''}${roomSettings()}<div class="lobby-actions">${host?button(`${icon('bot')}添加电脑玩家`,'addBot',busy||state.players.length>=maxPlayers(),'secondary'):button(mine().ready?`${icon('check')}已准备 · 取消`:'我准备好了','ready',busy,'primary')}${host?button(`开始探索 ${icon('arrow')}`,'start',busy||state.players.length<minPlayers()||state.players.some(p=>!p.bot&&p.id!==state.me&&(!p.ready||!p.online)),'primary'):''}</div><p class="muted small">${minPlayers()}–${maxPlayers()} 人开局。其他真人在线并准备后，由房主开始；电脑可补位。修改规则会取消准备。</p>${roomNavigation()}`;}
function gamePanel(){
  const me=mine(),active=myTurn(),disabled=busy||status!=='connected'||state.room?.paused;
  return `<div class="panel-heading"><h2>岛上的朋友</h2><span>目标 ${state.targetPoints||10} 分</span></div>${retention()}<p class="rules-summary">${esc(rulesLabel(state.options))}</p>${playerList()}<div class="awards"><span>${icon('road')}最长道路 <b>${state.longest?esc(state.players.find(p=>p.id===state.longest).name):'待争夺'}</b></span><span>${icon('flag')}最大军队 <b>${state.army?esc(state.players.find(p=>p.id===state.army).name):'待争夺'}</b></span>${state.options?.harbormaster?`<span>${icon('settlement')}卡坦港口 <b>${state.harbormaster?esc(state.players.find(p=>p.id===state.harbormaster)?.name):'待争夺'}</b></span>`:''}</div><section class="build-section"><div class="panel-heading"><h2>建设你的版图</h2></div>${['road','settlement','city','development'].map(k=>{
    const can=active&&state.phase==='action'&&afford(me.hand,COSTS[k])&&(k==='development'?state.deckCount>0:state.legal[k].length>0);
    return `<button type="button" class="build-button ${selectedBuild===k?'selected':''}" data-build="${k}" ${!can||disabled?'disabled':''}><span class="build-icon">${icon(k)}</span><span><b>${({road:'道路',settlement:'村庄',city:'城市',development:'发展卡'})[k]}</b><span class="cost">${resCost(COSTS[k])}</span></span>${k==='development'?`<small>${state.deckCount}</small>`:icon('arrow')}</button>`;
  }).join('')}</section><div class="turn-actions">${button(`${icon('trade')}资源交易`,'trade',disabled||!active||state.phase!=='action','secondary')}${state.phase==='roll'&&active?button(`${icon('dice')}掷出骰子`,'roll',disabled,'primary'):button(`结束回合 ${icon('arrow')}`,'endTurn',disabled||!active||state.phase!=='action','primary')}</div><div class="supply"><span>剩余棋子</span><b>${15-state.board.edges.filter(e=>e.owner===me.id).length} 路 · ${5-state.board.vertices.filter(v=>v.owner===me.id&&v.level===1).length} 村 · ${4-state.board.vertices.filter(v=>v.owner===me.id&&v.level===2).length} 城</b></div>${roomNavigation()}`;
}
function field(r,prefix,max=state?.profile?.resourceCount||19){return `<label class="resource-input ${r}" for="${prefix}-${r}"><span>${icon(r)}${LABELS[r]}</span><input data-persist id="${prefix}-${r}" type="number" inputmode="numeric" min="0" max="${max}" value="0" aria-label="${prefix==='discard'?'弃掉':prefix==='give'?'提供':prefix==='want'?'需要':'获取'}${LABELS[r]}数量"></label>`;}
function formBundle(prefix){return Object.fromEntries(RESOURCES.map(r=>[r,Number($(`#${prefix}-${r}`)?.value||0)]));}
function resourceOptions(selected){return RESOURCES.map(r=>`<option value="${r}" ${r===selected?'selected':''}>${LABELS[r]}</option>`).join('');}
function actionPanel(){
  if(state.room?.paused)return '<section class="choice-panel"><h2>对局已暂停</h2><p>等待房主恢复。牌局、资源与交易保持原状。</p></section>';
  if(state.phase==='discard'&&state.discards[state.me])return `<section class="choice-panel"><h2>放下 ${state.discards[state.me]} 张资源</h2><p>掷出了 7，你的手牌超过了 7 张。</p><form id="discard-form">${RESOURCES.map(r=>field(r,'discard',mine().hand[r])).join('')}<button class="primary" ${busy?'disabled':''}>确认弃牌</button></form></section>`;
  if(state.phase==='steal'&&myTurn())return `<section class="choice-panel"><h2>选择一位对手</h2><p>随机抽取对方的一张资源牌。</p>${state.legal.victims.map(id=>`<button class="secondary" data-victim="${id}">${esc(state.players.find(p=>p.id===id).name)} ${icon('arrow')}</button>`).join('')}</section>`;
  if(panel==='trade')return `<section class="choice-panel"><div class="panel-heading"><h2>交换资源</h2>${button(icon('close'),'closePanel',false,'square')}</div><form id="bank-form"><label for="bank-give">向银行提供</label><div class="bank-row"><select id="bank-give" data-persist>${resourceOptions('wood')}</select><b id="bank-ratio">4 : 1</b><select id="bank-want" data-persist aria-label="从银行获取">${resourceOptions('wheat')}</select></div><button class="primary" ${busy?'disabled':''}>确认银行交易</button></form>${state.pairStep!=='secondary'?`<form id="trade-form"><h3>向朋友发起交易</h3><div class="offer-columns"><div><b>我提供</b>${RESOURCES.map(r=>field(r,'give',mine().hand[r])).join('')}</div><div><b>我需要</b>${RESOURCES.map(r=>field(r,'want')).join('')}</div></div><button class="secondary" ${busy?'disabled':''}>发布交易请求</button></form>`:'<p class="muted small">配对伙伴建设阶段仅可向银行或港口交易，不能与其他玩家交易。</p>'}</section>`;
  if(panel==='development'&&cardId){const card=mine().dev.find(c=>c.id===cardId);if(!card)return '';return `<section class="choice-panel"><div class="panel-heading"><h2>${DEV_NAMES[card.type]}</h2>${button(icon('close'),'closePanel',false,'square')}</div><form id="development-form">${card.type==='plenty'?`<p>从银行选择共两张资源。</p>${RESOURCES.map(r=>field(r,'plenty',state.bank[r])).join('')}`:card.type==='monopoly'?`<label for="monopoly-resource">收取所有对手的哪种资源？</label><select id="monopoly-resource" data-persist>${resourceOptions('ore')}</select>`:`<p>${card.type==='knight'?'移动强盗，并从一位相邻对手手中抽一张资源。':'免费铺设两条道路，仍需连接自己的路网。'}</p>`}<button class="primary" ${busy?'disabled':''}>打出${DEV_NAMES[card.type]}</button></form></section>`;}
  return '';
}
function offer(){if(state.room?.paused)return '';const o=state.offer;if(!o)return '';return `<section class="trade-offer"><h3>${esc(state.players.find(p=>p.id===o.from).name)} 想和你交易</h3><div><span>提供</span>${resCost(Object.fromEntries(Object.entries(o.give).filter(([,n])=>n)))}</div><div><span>需要</span>${resCost(Object.fromEntries(Object.entries(o.want).filter(([,n])=>n)))}</div>${o.from===state.me?button('取消交易','cancelTrade',busy,'secondary'):button('接受这笔交易','acceptTrade',busy||!afford(mine().hand,o.want),'primary')}</section>`;}
function unreadChat(){return state?.chat.filter(c=>!seenChatIds.has(c.id)).length||0;}
function rightPanel(){
  if(!state)return publicRooms();
  if(state.phase==='lobby')return `<div class="island-guide"><span class="guide-mark">${icon('island')}</span><h2>从一座村庄开始</h2><div class="resource-legend">${RESOURCES.map(r=>`<span class="${r}" aria-label="${LABELS[r]}" title="${LABELS[r]}">${resourceIllustration(r)}</span>`).join('')}</div><p class="guide-note">收获 · 交易 · 建设</p></div>`;
  return `${state.phase==='finished'?`<section class="winner"><span>${icon('flag')}</span><h2>${esc(state.players.find(p=>p.id===state.winner).name)}<br>赢得了这座岛！</h2><p>${state.players.find(p=>p.id===state.winner).points} 个胜利点</p>${isHost()?button('再来一局','rematch',busy,'primary'):''}${button('返回首页','home',false,'secondary')}</section>`:''}${actionPanel()}${offer()}<details id="activity-details" class="secondary-panel" ${matchMedia('(max-width:640px)').matches?'':'open'}><summary>岛屿记事 <small>回合 ${state.turnNo||'准备'}</small></summary><section class="log-section"><div class="activity-log" aria-live="polite">${state.log.slice(-18).map(l=>`<p>${esc(l.text)}</p>`).join('')}</div></section></details><details id="chat-details" class="secondary-panel" ${matchMedia('(max-width:640px)').matches?'':'open'}><summary>围桌聊聊 <small class="chat-unread">${unreadChat()?unreadChat()+' 条新消息':''}</small></summary><section class="chat-section"><div class="chat-log">${state.chat.length?state.chat.slice(-12).map(c=>`<p><strong>${esc(c.name)}</strong> ${esc(c.text)}</p>`).join(''):'<p class="muted">和朋友打声招呼，或聊聊交易。</p>'}</div><form id="chat-form"><input id="chat-message" data-persist maxlength="200" placeholder="说点什么…" aria-label="聊天消息"><button class="square" aria-label="发送消息" ${busy?'disabled':''}>${icon('arrow')}</button></form></section></details>`;
}
function banner(){
  if(!state||state.phase==='lobby')return '';
  if(state.room?.paused)return '<div class="turn-banner paused-banner"><div><strong>房主已暂停对局</strong><span>暂停期间不能交易或操作棋盘，等待房主恢复。</span></div></div>';
  const p=state.players[state.turn],self=myTurn();
  const descriptions={ 'setup-settlement':'选择一个亮色交叉点，建造村庄','setup-road':'选择与新村庄相连的道路',roll:'掷出骰子，看看岛屿的收获',action:selectedBuild?`点击亮色标记，建造${{road:'道路',settlement:'村庄',city:'城市'}[selectedBuild]}`:'交易、建设，让你的版图更进一步',discard:'等待手牌超过 7 张的玩家弃牌',robber:'点击一块新的土地，移动强盗',steal:'选择一位相邻对手，抽取资源','road-building':`还可以免费铺设 ${state.freeRoads} 条道路`,finished:'对局已结束，感谢这一次相聚'};
  return `<div class="turn-banner ${self?'your-turn':''}"><span class="turn-dot" style="background:${p.color}"></span><div><strong>${state.phase==='finished'?'岛屿已迎来胜者':self?'轮到你了':`等待 ${esc(p.name)}`}</strong><span>${state.pairStep==='secondary'&&state.phase==='action'?'配对伙伴建设：可银行交易、建设与使用发展卡，然后结束阶段':descriptions[state.phase]||''}</span></div>${state.dice?`<div class="dice-pair" aria-label="骰子 ${state.dice.join(' 加 ')}">${state.dice.map(n=>`<span>${n}</span>`).join('')}</div>`:icon(self?'flag':'users')}</div>`;
}
function hand(){if(!state?.board)return '';return `<div class="hand-tray"><div class="hand-label"><strong>你的资源</strong><span>${total(mine().hand)} 张手牌</span></div><div class="resource-hand">${RESOURCES.map(r=>`<div class="resource-card ${r}" aria-label="${LABELS[r]} ${mine().hand[r]} 张" title="${LABELS[r]}：${mine().hand[r]} 张，银行剩余 ${state.bank[r]} 张"><span class="resource-art">${resourceIllustration(r)}</span><strong>${mine().hand[r]}</strong></div>`).join('')}</div><div class="development-hand">${mine().dev.map(c=>`<button data-card="${c.id}" ${busy||state.room?.paused||!myTurn()||!['roll','action'].includes(state.phase)||state.playedDev||c.type==='victory'||c.bought>=state.turnNo?'disabled':''} title="${c.type==='victory'?'私下自动计入胜利点':c.bought>=state.turnNo?'本回合购入，下回合可用':'打出这张发展卡'}">${icon(c.type==='knight'?'flag':'development')}${DEV_NAMES[c.type]}${c.bought>=state.turnNo&&c.type!=='victory'?'<small>新</small>':''}</button>`).join('')}</div></div>`;}
function render(){
  const detailsState=new Map([...document.querySelectorAll('details[id]')].map(el=>[el.id,el.open]));
  const inputs=new Map([...document.querySelectorAll('[data-persist]')].map(el=>[el.id,el.type==='checkbox'?el.checked:el.value])),active=document.activeElement?.id,start=document.activeElement?.selectionStart;
  $('#table').className=`table ${state?'in-room':'home'} ${state?.board?'playing':''}`;
  $('#room-meta').innerHTML=code?`<span class="connection ${status}"><i></i>${statusText()}</span><span class="room-code">房间 ${displayCode(code)}</span>${button(`${icon('link')}<span>邀请好友</span>`,'invite',false,'text-button')}${state?button(icon('back'),'home',false,'square'):button('取消连接','home',false,'text-button')}`:'<span class="header-note">把朋友聚在一张桌上</span>';
  $('#left-panel').innerHTML=state?(state.phase==='lobby'?lobbyPanel():gamePanel()):homePanel();
  $('#right-panel').innerHTML=rightPanel();$('#turn-banner').innerHTML=banner();$('#hand').innerHTML=hand();
  document.querySelector('#room-meta [data-action="home"]')?.setAttribute('aria-label','返回首页');
  document.querySelector('[data-action="closePanel"]')?.setAttribute('aria-label','关闭操作面板');
  $('#island-caption').innerHTML=state?.board?'':`<span>一场新的冒险，正等着你。</span><strong>卡坦岛</strong><span>探索 · 交易 · 建设</span>`;
  for(const [id,value] of inputs){const el=document.getElementById(id);if(el){if(el.type==='checkbox')el.checked=value;else el.value=value;}}
  for(const [id,open] of detailsState){const el=document.getElementById(id);if(el)el.open=open;}
  if(active){const el=document.getElementById(active);if(el){el.focus({preventScroll:true});if(start!=null && ['text','search'].includes(el.type))try{el.setSelectionRange(start,start);}catch{}}}
  board?.set(state?.board?state:preview,mode());
  for(const el of document.querySelectorAll('.activity-log,.chat-log'))el.scrollTop=el.scrollHeight;
  bindForms();updateRatio();
  document.querySelector('[data-action="confirmRoomDialog"]').disabled=busy;
}
function updateRatio(){if($('#bank-ratio'))$('#bank-ratio').textContent=`${ownRatio($('#bank-give').value)} : 1`;}
function bindForms(){
  if($('#chat-details'))$('#chat-details').ontoggle=()=>{if($('#chat-details')?.open&&state){for(const chat of state.chat)seenChatIds.add(chat.id);const badge=$('.chat-unread');if(badge)badge.textContent='';}};
  if($('#room-settings-form'))$('#room-settings-form').onsubmit=e=>{e.preventDefault();send({type:'configure',visibility:$('#room-visibility').value,options:readOptions('room')});};
  if($('#entry-form'))$('#entry-form').onsubmit=e=>{e.preventDefault();join();};if($('#create-room'))$('#create-room').onclick=()=>create();
  if($('#discard-form'))$('#discard-form').onsubmit=e=>{e.preventDefault();send({type:'discard',cards:formBundle('discard')});};
  if($('#bank-form'))$('#bank-form').onsubmit=e=>{e.preventDefault();send({type:'bankTrade',give:$('#bank-give').value,want:$('#bank-want').value});};
  if($('#bank-give'))$('#bank-give').onchange=updateRatio;
  if($('#trade-form'))$('#trade-form').onsubmit=e=>{e.preventDefault();send({type:'offerTrade',give:formBundle('give'),want:formBundle('want')});};
  if($('#chat-form'))$('#chat-form').onsubmit=e=>{e.preventDefault();const el=$('#chat-message'),text=el.value.trim();if(text){el.value='';send({type:'chat',text});}};
  if($('#development-form'))$('#development-form').onsubmit=e=>{e.preventDefault();send({type:'playDevelopment',cardId,cards:formBundle('plenty'),resource:$('#monopoly-resource')?.value});};
}
document.addEventListener('click',async e=>{
  const nav=e.target.closest('a[data-lobby-link],a[data-home-link]');if(nav&&code){e.preventDefault();openLeave(nav.hasAttribute('data-lobby-link')?'lobby':'home');return;}
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.build){if(b.dataset.build==='development')return send({type:'buyDevelopment'});selectedBuild=selectedBuild===b.dataset.build?'':b.dataset.build;panel='';return render();}
  if(b.dataset.listRoom){const room=b.dataset.listRoom,name=$('#nickname')?.value.trim()||storage.get('name');if(!name){toast('先填写你的昵称，再加入房间。');$('#nickname')?.focus();return;}return connect(room,storage.get(`token:${room}`)||newId(),name);}
  if(b.dataset.kick)return openConfirmation({type:'kick',playerId:b.dataset.kick},'移出玩家',`将 ${state.players.find(p=>p.id===b.dataset.kick)?.name||'该玩家'} 移出等待房间？对方席位及原身份将失效。`,'确认移出');
  if(b.dataset.transfer)return openConfirmation({type:'transferHost',playerId:b.dataset.transfer},'转交房主',`将房主权限交给 ${state.players.find(p=>p.id===b.dataset.transfer)?.name||'该玩家'}？你的座位保留，解散与房间设置权限会立即转移。`,'确认转交');
  if(b.dataset.removeBot)return send({type:'removeBot',playerId:b.dataset.removeBot});
  if(b.dataset.victim)return send({type:'steal',victim:b.dataset.victim});
  if(b.dataset.card){cardId=b.dataset.card;panel='development';return render();}
  const action=b.dataset.action;
  if(action==='ready')return send({type:'ready',ready:!mine().ready});
  if(action==='refreshRooms')return refreshRooms();
  if(action==='loadMoreRooms')return refreshRooms(true);
  if(action==='transferMenu'){openConfirmation({type:'chooseTransfer'},'转交房主','转交后你的座位保留，房主权限与房间离线保留期归新房主管理。','确认转交');$('#room-dialog-copy').insertAdjacentHTML('beforeend',`<label for="transfer-choice">选择在线玩家</label><select id="transfer-choice">${state.players.filter(p=>p.id!==state.me&&!p.bot&&p.online).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>`);return;}
  if(action==='pauseGame')return openConfirmation({type:'pause'},'暂停对局','暂停后所有棋盘操作停止。你在本次暂停中首次离线时开始固定 4 小时保留，短暂重连不会延长截止时间。','确认暂停');
  if(action==='resumeGame')return send({type:'resume'});
  if(action==='dissolve')return openConfirmation({type:'close'},'解散房间','解散会结束所有成员的房间，旧邀请、存档与重连都不能恢复。此操作与暂离不同。','确认解散');
  if(action==='cancelRoomDialog'){confirmation=null;return $('#room-dialog').close();}
  if(action==='confirmRoomDialog')return confirmRoomDialog();
  if(['start','addBot','roll','endTurn','cancelTrade','rematch'].includes(action))return send({type:action});
  if(action==='acceptTrade')return send({type:'acceptTrade',offerId:state.offer.id});
  if(action==='rules')return $('#rules-dialog').showModal();if(action==='closeRules')return $('#rules-dialog').close();
  if(action==='reset')return board.reset();
  if(action==='practice')return create(true);
  if(action==='trade'){panel=panel==='trade'?'':'trade';selectedBuild='';render();return;}
  if(action==='closePanel'){panel='';return render();}
  if(action==='resume'){const last=storage.get('last');if(last)connect(last.code,last.token,last.name);return;}
  if(action==='home')return openLeave('home');
  if(action==='invite'){const link=invitationURL(location.origin,code,backendId);try{await navigator.clipboard.writeText(link);toast('邀请链接已复制，发给朋友即可加入。');}catch{toast(`房间码：${displayCode(code)}。将当前页面地址发给朋友即可。`);}return;}
  if(b.id==='flat-toggle'){flat=!flat;makeBoard();}
});
function forgetIdentity(room){storage.set(`token:${room}`,null);if(storage.get('last')?.code===room)storage.set('last',null);}
function terminal(message){const current=code;forgetIdentity(current);terminalMessage=message.message||(message.type==='removed'?'你已被移出房间，原身份已失效。':'房间已关闭，旧链接不能恢复。');connection?.close();connection=null;state=null;code='';status='idle';invite='';history.replaceState(null,'','/');$('#room-dialog').close();confirmation=null;render();refreshRooms();}
function exitView(destination){connection?.close();connection=null;state=null;code='';status='idle';selectedBuild='';panel='';invite='';history.replaceState(null,'','/');if(destination==='lobby'){const target=gameLobbyURL(backendId);if(target){location.assign(target);return;}}render();refreshRooms();}
function openConfirmation(task,title,description,confirmText='确认'){confirmation=task;$('#room-dialog-title').textContent=title;$('#room-dialog-copy').textContent=description;document.querySelector('[data-action="confirmRoomDialog"]').textContent=confirmText;$('#room-dialog').showModal();}
function openLeave(destination){if(!code)return exitView(destination);const description=state?leaveDescription({lobby:state.phase==='lobby',host:isHost(),practice:state.room?.practice,paused:state.room?.paused,target:destination==='lobby'?'游戏大厅':'首页'}):`取消连接并返回${destination==='lobby'?'当前服务器游戏大厅':'首页'}。`;openConfirmation({type:'navigate',destination},state?.phase==='lobby'&&!isHost()?'退出座位':'暂离房间',description,state?.phase==='lobby'&&!isHost()?'退出并返回':'暂离并返回');}
async function confirmRoomDialog(){let task=confirmation;if(task?.type==='chooseTransfer')task={type:'transferHost',playerId:$('#transfer-choice')?.value};if(!task||busy)return;$('#room-dialog').close();confirmation=null;if(task.type==='navigate'){const release=state?.phase==='lobby'&&!isHost(),current=code;if(state&&!(state.phase==='lobby'&&isHost())&&!(await send({type:'leave'})))return;if(release)forgetIdentity(current);return exitView(task.destination);}await send(task);}
setInterval(()=>{const el=$('#room-retention'),room=state?.room;if(el&&Number.isFinite(room?.expiresAt)){const remaining=remainingTime(room.expiresAt,room.serverNow,receivedAt);el.textContent=`${room.retentionReason==='paused'||room.paused?'本次暂停固定期限':'房主离线保留'} · 剩余 ${remaining}，到期后房间关闭并清理。`;}},1000);
makeBoard();render();
if(!entryError)refreshRooms();
const last=storage.get('last');if(!entryError&&invite&&last?.code===invite)connect(last.code,last.token,last.name);
window.addEventListener('online',()=>{if(connection&&!connection.stopped&&connection.ws.readyState>1){clearTimeout(connection.reconnectTimer);connection.connect();}});
