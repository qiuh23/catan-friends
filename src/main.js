import './style.css';
import './table.css';
import './entry.css';
import './map-first.css';
import './immersive-polish.css';
import { Board, FlatBoard } from './board.js';
import { Connection } from './connection.js';
import { icon, resourceIllustration, dieFace } from './icons.js';
import { newId } from './id.js';
import { readRoom, readInvitation, invitationURL, lobbyOrigins } from './invitation.js';
import { createBoard, RESOURCES, LABELS, emptyHand, total } from '../shared/board.js';
import { COSTS, DEV_NAMES, afford } from '../shared/game.js';
import { variantOptions, rulesLabel, roomAvailability, remainingTime, gameLobbyURL, leaveDescription, mergeRoomPages, expansionForCount } from './room-ui.js';
import { requiredTask } from './table-layout.js';
import { ActionFeedbackCursor, mergeFeedbackEvents } from './action-feedback.js';
import { installDialogDismissal } from './dialogs.js';
import { placeMapBubble } from './map-bubble.js';

const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage={get(key){try{return JSON.parse(localStorage.getItem(`catan:${key}`));}catch{return null;}},set(key,value){try{localStorage.setItem(`catan:${key}`,JSON.stringify(value));}catch{}}};
let state=null,connection=null,code='',status='idle',busy=false,selectedBuild='',panel='',cardId='',flat=false,board;
let seenChatIds=new Set(),chatBusy=false,chatAttempt=null,reportInfo=null,reportContext='';
let roomList={status:'loading',rooms:[],error:'',nextCursor:null,moreStatus:'idle',moreError:''},listRequest=0,terminalMessage='',receivedAt=Date.now(),confirmation=null;
let previewSeed=17;const preview={board:createBoard(()=>{previewSeed=(previewSeed*1664525+1013904223)>>>0;return previewSeed/4294967296;}),players:[],robber:null,legal:{}};
const largePreview={...preview,board:createBoard(undefined,{playerExpansion:'five-six-2025'})};
const sceneState=()=>state?.board?state:state?.players.length>4?largePreview:preview;
let stagePanel='', focusedPlayer='';
const savedBoardViews=new Map();
const feedbackCursor=new ActionFeedbackCursor(), motionQuery=matchMedia('(prefers-reduced-motion:reduce)');
let autoFollow=storage.get('auto-follow')!==false, followPaused=false, motionPreference=storage.get('reduce-motion');
let actionFeedback=null, feedbackBurst=[], feedbackTimer=0, highlightTimer=0, lastCameraAt=0, feedbackEpoch='', feedbackCanFollow=false;
const reducedMotion=()=>typeof motionPreference==='boolean'?motionPreference:motionQuery.matches;
const inputDrafts=new Map(), panelScroll=new Map();
let draftScope='home';
let viewSaveTimer=0;
let lastTaskKey='';
let backendId='local',invite='',entryError='';
let replaceViewURL=url=>history.replaceState(null,'',url);
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
  <main id="table" class="table home"><aside id="left-panel"></aside><section class="board-area" aria-label="游戏棋盘"><div id="board"></div><div class="board-top" id="turn-banner" aria-live="polite"></div><section id="action-feedback" aria-label="公开行动反馈" hidden><p id="action-feedback-text" role="status" aria-live="polite" aria-atomic="true"></p></section><div class="board-controls">${button(icon('reset'),'reset',false,'square')}<button class="square" id="flat-toggle" type="button" aria-label="切换二维棋盘">2D</button></div><div id="tile-hint" class="tile-hint">拖动旋转 · 双指或滚轮缩放</div><div id="hand"></div><div id="island-caption"></div></section><nav id="stage-tools" aria-label="对局工具"></nav><section id="play-dock" aria-label="建设与回合操作"></section><aside id="right-panel"></aside></main>
  <dialog id="stage-dialog" aria-labelledby="stage-dialog-title"><div class="dialog-heading"><h2 id="stage-dialog-title"></h2>${button(icon('close'),'closeStagePanel',false,'square')}</div><p id="stage-feedback" role="status" aria-live="polite"></p><div id="stage-dialog-content"></div></dialog><dialog id="room-dialog" aria-labelledby="room-dialog-title"><div class="dialog-heading"><h2 id="room-dialog-title"></h2>${button(icon('close'),'cancelRoomDialog',false,'square')}</div><p id="room-dialog-copy"></p><div class="dialog-actions">${button('取消','cancelRoomDialog',false,'secondary')}${button('确认','confirmRoomDialog',false,'primary')}</div></dialog><div id="toast" role="status" aria-live="polite"></div><dialog id="rules-dialog"><div class="dialog-heading"><h2>在岛上，建立你的世界。</h2>${button(icon('close'),'closeRules',false,'square')}</div><div class="rules-copy"><p>经典基础版为 3–4 人；5–6 人扩充采用大岛屿与 2025 配对回合。基础版默认达到 <strong>10 个胜利点</strong>获胜。可选拓展在建房时选择，开局前由房主调整，规则对所有人公开。</p><h3>先为自己找个好位置</h3><p>每人放置两座村庄与两条道路：第一轮顺序放置，第二轮反向放置。第二座村庄会收取相邻地块各 1 张资源。任意两座村庄之间必须至少隔一个空交叉点。</p><h3>掷骰、收获、交易、建造</h3><p>掷出两枚骰子，数字对应的地块向相邻村庄生产 1 张资源，向城市生产 2 张。所有玩家都可能收获。随后可多次交易、建造或购买发展卡，完成后结束回合。</p><div class="rules-costs">${Object.entries(COSTS).map(([k,c])=>`<div>${icon(k)}<b>${({road:'道路',settlement:'村庄',city:'城市',development:'发展卡'})[k]}</b>${resCost(c)}</div>`).join('')}</div><h3>强盗与七点</h3><p>掷出 7 时不生产资源。手牌超过 7 张的玩家须弃掉一半（向下取整）；当前玩家移动强盗，并从相邻的一名对手处随机抽一张资源。强盗所在格停止生产。</p><h3>把资源换成机会</h3><p>可向其他玩家提出交易，由对方接受。银行默认 4:1；拥有普通港口时 3:1，对应专属港口为 2:1。只能在自己的行动阶段主动发起交易。</p><h3>发展卡与额外得分</h3><p>每回合最多使用一张非胜利点发展卡，当回合购买的不能使用。骑士移动强盗；道路建设免费建造最多两条路；丰收从银行取两张资源；垄断收取所有对手的一种资源。胜利点卡私下自动计分。</p><p>村庄 1 分，城市 2 分。最长道路至少 5 段、最大骑士军队至少 3 张，各值 2 分；平手时原持有者保留。对手建筑会截断道路。</p><h3>可选拓展（2025 规则）</h3><p><strong>友善强盗：</strong>公开分不超过 2 分的玩家，其建筑相邻地块不能放置强盗；掷出 7 仍正常弃牌。<strong>卡坦港口：</strong>港口村庄计 1 港口分、城市计 2 分，首达 3 港口分取得 2 胜利分奖励，严格超过现持有者时转交。启用后目标为 11 胜利分。两项变体均兼容 3–6 人，按开局实际入座人数自动匹配基础版或人数扩充，之后冻结至本局结束。</p><h3>5–6 人扩充 · 2025 配对回合</h3><p>每个常规回合由主玩家掷骰并行动，之后由相隔三席的配对伙伴进行一次建设阶段。伙伴可以银行与港口交易、建设、购买和使用发展卡并获胜，不能再次掷骰或与其他玩家交易。伙伴结束后轮到下一位主玩家掷骰。本模式使用扩大的岛屿、资源与发展卡供应。</p><h3>暂离、暂停与房间保留</h3><p class="muted">普通真人房从房主最后一个有效连接离线起保留 30 分钟。房主主动暂停的真人房，从本次暂停首次离线起固定保留最多 4 小时，短暂重连不延长截止时间。真人与练习均可由房主暂停和恢复；暂停会停止电脑与对局操作，聊天仍可用。练习房离开后仍保留 10 分钟，暂停不延长。房主在线时不会因普通闲置关闭。对局中暂离保留身份；等待阶段非房主主动退座释放席位。解散由房主单独确认。</p></div></dialog>`;
document.querySelector('[data-action="rules"]').setAttribute('aria-label','玩法指南');
document.querySelector('[data-action="cancelRoomDialog"]').setAttribute('aria-label','关闭房间确认');
document.querySelector('[data-action="closeRules"]').setAttribute('aria-label','关闭玩法指南');
document.querySelector('.topbar nav').insertAdjacentHTML('beforeend',`<button type="button" data-action="report" class="text-button" aria-label="隐私 / 举报" title="隐私 / 举报">${icon('shield')}</button>`);
document.querySelector('#app').insertAdjacentHTML('beforeend',`<dialog id="report-dialog" aria-labelledby="report-title"><div class="dialog-heading"><h2 id="report-title">隐私 / 举报</h2>${button(icon('close'),'closeReport',false,'square')}</div><div id="report-copy"></div></dialog>`);
document.querySelector('[data-action="closeReport"]').setAttribute('aria-label','关闭举报说明');
document.querySelector('#app').insertAdjacentHTML('beforeend',`<dialog id="practice-dialog" aria-labelledby="practice-title"><div class="dialog-heading"><h2 id="practice-title">人机练习</h2>${button(icon('close'),'closePractice',false,'square')}</div><form id="practice-form"><div id="practice-options"></div><div id="practice-seats" class="practice-seats" aria-live="polite"></div><p id="practice-feedback" role="alert"></p><button id="practice-start" type="submit" class="primary">${icon('bot')}开始练习 ${icon('arrow')}</button></form></dialog>`);
document.querySelector('[data-action="closePractice"]').setAttribute('aria-label','关闭练习设置');
document.querySelector('#table').insertAdjacentHTML('beforeend',`<nav id="player-orbit" aria-label="本桌玩家"></nav><nav id="home-dock" aria-label="开始游戏">${button(`${icon('island')}<span>开始游戏</span>`,'openEntry',false,'primary')}${button(`${icon('bot')}<span>人机练习</span>`,'homePractice')}${button(`${icon('users')}<span>在线房间</span>`,'openRooms')}</nav>`);
document.querySelector('#app').insertAdjacentHTML('beforeend',`<dialog id="entry-dialog" aria-labelledby="entry-title"><div class="dialog-heading"><h2 id="entry-title">开桌 / 加入</h2>${button(icon('close'),'closeEntry',false,'square')}</div><div id="entry-content"></div></dialog><dialog id="rooms-dialog" aria-label="在线房间"><div class="dialog-heading"><h2>在线房间</h2>${button(icon('close'),'closeRooms',false,'square')}</div><div id="rooms-content"></div></dialog>`);
document.querySelector('[data-action="closeEntry"]').setAttribute('aria-label','关闭开始游戏');
document.querySelector('[data-action="closeRooms"]').setAttribute('aria-label','关闭在线房间');
document.querySelector('.board-area').insertAdjacentHTML('beforeend','<svg id="action-feedback-leader" aria-hidden="true" hidden><defs><mask id="feedback-line-mask" maskUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="white"/><g id="feedback-line-cutouts"></g></mask></defs><path mask="url(#feedback-line-mask)"/></svg>');
const resetButton=document.querySelector('[data-action="reset"]');resetButton.setAttribute('aria-label','复位棋盘视角');
function toast(text){if($('#stage-dialog').open){$('#stage-feedback').textContent=text;return;}const el=$('#toast');el.textContent=text;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),4500);}
async function sendChat(event){
  event.preventDefault();
  const raw=$('#chat-message').value,text=raw.trim(),owner=connection;
  if(!text||chatBusy)return;
  const attempt=chatAttempt?.owner===owner && chatAttempt.text===text?chatAttempt:{owner,text,id:newId()};chatAttempt=attempt;
  chatBusy=true;$('#stage-feedback').textContent='';render();
  try{
    await owner.action({type:'chat',text},{id:attempt.id});
    if(connection!==owner)return;
    if(chatAttempt===attempt)chatAttempt=null;
    const current=$('#chat-message');
    // Acknowledge the submitted draft without erasing edits typed while waiting.
    if(current?.value===raw)current.value='';
    if(inputDrafts.get('chat-message')===raw)inputDrafts.set('chat-message','');
  }catch(error){if(connection===owner){if(error.definitive&&chatAttempt===attempt)chatAttempt=null;toast(error.message);}}
  finally{if(connection===owner){chatBusy=false;render();}}
}
function renderReport(){
  const el=$('#report-copy');
  if(!reportInfo){el.innerHTML='<p>正在读取本站配置…</p>';return;}
  if(reportInfo.failed){el.innerHTML='<p>暂时无法读取举报联系方式，请稍后重新打开。</p>';return;}
  const contact=reportInfo.contact;
  const subject=`卡坦岛举报 · ${backendId} · ${code?displayCode(code):'首页'}`;
  const body=`线路：${location.origin}\n房间：${code?displayCode(code):'无'}\n${reportContext}\n举报原因：\n\n请勿提供恢复凭据、完整手牌或证件。`;
  el.innerHTML=`<p>举报聊天、昵称或房间问题，可提供线路、房间码、消息编号、时间和原因。站长人工核实后可隐藏消息、重置昵称、限制该游戏身份或关闭房间。</p>${reportContext?`<p class="report-context">${esc(reportContext)}</p>`:''}<p>${contact?`举报邮箱：<a id="report-mail" href="mailto:${esc(contact)}?subject=${encodeURIComponent(subject)}&amp;body=${encodeURIComponent(body)}">${esc(contact)} · 用邮件举报</a>`:'本站举报联系方式待配置，邮件举报暂不可用。'}</p><p class="small muted">点击邮箱会打开邮件编辑器，由你确认发送。请勿附恢复凭据、完整手牌或证件。</p><p>普通聊天仅保留本房间最近 ${Number(reportInfo.chatLimit)||100} 条，最长 ${Number(reportInfo.chatDays)||7} 天，关闭房间后清理。${reportInfo.retentionDays?`必要处置记录按当前配置保留 ${Number(reportInfo.retentionDays)} 天；人工保全项至明确解除。`:'处置记录留存期限待配置。'}${reportInfo.adminReady?'站长处置接口已配置；具体举报由人工核实。':'站长处置接口尚未启用。'}</p><p class="small muted">以上是当前运行配置，适用备案、留存及处置要求仍需运营者核实。</p>`;
}
async function openReport(message){
  reportContext=message?`消息 #${message.seq} · ${new Date(message.sentAt).toLocaleString('zh-CN',{hour12:false})}`:'';
  reportInfo=null;renderReport();if(!$('#report-dialog').open)$('#report-dialog').showModal();
  try{const response=await fetch('/api/security/contact',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error();reportInfo=await response.json();}
  catch{reportInfo={failed:true};}
  renderReport();
}
function mode(){if(!state||!myTurn()||state.room?.paused)return '';if(state.phase==='setup-settlement')return 'settlement';if(['setup-road','road-building'].includes(state.phase))return 'road';if(state.phase==='robber')return 'robber';return state.phase==='action'?selectedBuild:'';}
function makeBoard(){if(board)savedBoardViews.set(board instanceof FlatBoard,board.exportView?.());board?.dispose();$('#board').innerHTML='';try{board=flat?new FlatBoard($('#board'),select,hover):new Board($('#board'),select,hover);}catch(error){flat=true;board=new FlatBoard($('#board'),select,hover);toast('当前设备无法开启 3D，已切换到二维棋盘。');}board.onManual=pauseFollowing;board.onProjectionChange=()=>{positionActionFeedback();if(!viewSaveTimer)viewSaveTimer=setTimeout(saveBoardView,120);};$('#flat-toggle').textContent=flat?'3D':'2D';$('#flat-toggle').setAttribute('aria-label',flat?'切换三维棋盘':'切换二维棋盘');syncViewport();board.set(sceneState(),mode());if(!board.importView?.(storedBoardView()))board.importView?.(savedBoardViews.get(flat));board.setFeedback?.(actionFeedback,{reducedMotion:reducedMotion()});positionActionFeedback();}
function storedBoardView(){if(!state?.board||!code)return null;try{return JSON.parse(sessionStorage.getItem(`catan:view:${backendId}:${code}:${state.me}:${flat}`)||'null');}catch{return null;}}
function saveBoardView(){clearTimeout(viewSaveTimer);viewSaveTimer=0;if(!state?.board||!code)return;try{sessionStorage.setItem(`catan:view:${backendId}:${code}:${state.me}:${flat}`,JSON.stringify({...board.exportView?.(),followPaused}));sessionStorage.setItem(`catan:renderer:${backendId}:${code}:${state.me}`,JSON.stringify(flat));}catch{}}
function restoreBoardView(){if(!state?.board)return;try{const preference=JSON.parse(sessionStorage.getItem(`catan:renderer:${backendId}:${code}:${state.me}`)||'null');if(typeof preference==='boolean'&&preference!==flat){flat=preference;makeBoard();render();}const view=JSON.parse(sessionStorage.getItem(`catan:view:${backendId}:${code}:${state.me}:${flat}`)||'null');if(board.importView?.(view)){followPaused=Boolean(view.followPaused??view.viewMode==='manual');paintCameraControls();}}catch{}}
function cameraControls(){return `<button id="camera-overview" type="button" data-action="overview" class="camera-overview" aria-label="回到全局" title="回到全局">${icon('focus')}<span>全局</span></button><button id="camera-follow" type="button" data-action="toggleFollow" aria-pressed="${autoFollow&&!followPaused}" aria-label="${!autoFollow?'开启自动跟随':followPaused?'恢复自动跟随':'暂停自动跟随'}" title="${!autoFollow?'开启自动跟随':followPaused?'恢复自动跟随':'暂停自动跟随'} · 拖动、缩放会暂停">${icon(autoFollow&&!followPaused?'follow':'pause')}<span>${!autoFollow?'跟随关':followPaused?'手动':'跟随中'}</span></button>`;}
function paintCameraControls(){const el=$('#camera-toolbar');if(!el)return;const active=el.contains(document.activeElement)?document.activeElement.id:'';el.dataset.followState=!autoFollow?'off':followPaused?'manual':'following';paint('#camera-toolbar',cameraControls());if(active)document.getElementById(active)?.focus({preventScroll:true});}
function pauseFollowing(){followPaused=true;feedbackCanFollow=false;board?.cancelFocus?.();paintCameraControls();saveBoardView();}
function cameraBlocked(){return !state?.board||status!=='connected'||busy||Boolean(mode())||Boolean(state.room?.paused)||Boolean(document.querySelector('dialog[open]'))||Boolean(document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))||document.hidden;}
function clearActionFeedback(){clearTimeout(feedbackTimer);clearTimeout(highlightTimer);feedbackTimer=0;highlightTimer=0;feedbackBurst=[];feedbackCanFollow=false;actionFeedback=null;board?.setFeedback?.(null);paintActionFeedback();}
function positionActionFeedback(){
  const el=$('#action-feedback'),leader=$('#action-feedback-leader');leader?.setAttribute('hidden','');
  if(!actionFeedback||el.hidden)return;
  if(document.querySelector('dialog[open]')){el.style.visibility='hidden';return;}
  const target=actionFeedback.bubbleTarget,point=target?board?.projectFeedbackTarget?.(target):null,bounds=$('#board').getBoundingClientRect();
  let x,y;
  if(target){
    el.dataset.target=`${target.kind}:${target.id}`;
    if(!point?.visible){el.style.visibility='hidden';return;}x=point.x;y=point.y;
  }else{
    const actor=document.querySelector(`[data-player="${CSS.escape(actionFeedback.actorId)}"]`),anchor=actor||$('#play-dock'),r=anchor?.getBoundingClientRect();if(!r){el.style.visibility='hidden';return;}
    x=r.left+r.width/2-bounds.left;y=r.bottom-bounds.top+12;el.dataset.target=actor?`actor:${actionFeedback.actorId}`:'controls';
  }
  const obstacles=[...document.querySelectorAll('.stage-primary,.stage-utilities,#player-orbit,#play-dock,.hand-tray,#turn-banner>div')].filter(node=>node.getClientRects().length).map(node=>{const r=node.getBoundingClientRect();return{x:r.left-bounds.left-4,y:r.top-bounds.top-4,width:r.width+8,height:r.height+8};});
  // Number tokens remain legible even for an action on an adjacent edge.
  obstacles.push(...(board?.projectNumberObstacles?.()||[]));
  const placement=placeMapBubble({x,y},{width:el.offsetWidth,height:el.offsetHeight},{width:bounds.width,height:bounds.height},obstacles);
  el.style.visibility=placement.blocked?'hidden':'visible';el.style.left=`${placement.x}px`;el.style.top=`${placement.y}px`;el.dataset.anchor=JSON.stringify({x,y});
  if(target&&leader&&!placement.blocked){leader.removeAttribute('hidden');$('#feedback-line-cutouts').innerHTML=obstacles.map(r=>`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="2" fill="black"/>`).join('');leader.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);leader.querySelector('path').setAttribute('d',`M${x},${y} L${placement.edge.x},${placement.edge.y}`);}
}
function paintActionFeedback(){
  const el=$('#action-feedback'),shown=Boolean(actionFeedback&&state?.board);el.hidden=!shown;
  $('#table').classList.toggle('has-action-feedback',shown);
  if(!shown){$('#action-feedback-leader')?.setAttribute('hidden','');el.dataset.eventId='';el.dataset.eventIds='';el.dataset.kind='';el.dataset.target='';el.dataset.anchor='';$('#action-feedback-text').textContent='';return;}
  const text=$('#action-feedback-text');if(text.textContent!==actionFeedback.text)text.textContent=actionFeedback.text;
  el.dataset.eventId=String(actionFeedback.id);el.dataset.eventIds=(actionFeedback.eventIds||[actionFeedback.id]).join(',');el.dataset.kind=actionFeedback.kind;
  positionActionFeedback();
}
function showActionFeedback(){
  const events=feedbackBurst,canFollow=feedbackCanFollow;feedbackBurst=[];feedbackTimer=0;feedbackCanFollow=false;if(!events.length||!state?.board)return;
  actionFeedback=mergeFeedbackEvents(events);
  const latest=events.at(-1);actionFeedback.bubbleTarget=latest.targets.at(-1)||null;
  if(events.some(event=>event.actorId!==latest.actorId||JSON.stringify(event.targets)!==JSON.stringify(latest.targets)))actionFeedback.text=`${latest.text} · +${events.length-1} 项（记录）`;
  paintActionFeedback();
  board?.setFeedback?.(actionFeedback,{reducedMotion:reducedMotion()});
  clearTimeout(highlightTimer);const displayed=actionFeedback;
  highlightTimer=setTimeout(()=>{if(actionFeedback!==displayed)return;actionFeedback=null;board?.setFeedback?.(null);paintActionFeedback();},1250);
  // Busy bursts get one summary and a static highlight, never a camera backlog.
  if(canFollow&&autoFollow&&!followPaused&&!reducedMotion()&&!cameraBlocked()&&Date.now()-lastCameraAt>3500&&actionFeedback.targets.length){
    if(board?.focusFeedback?.(actionFeedback,{reducedMotion:false}))lastCameraAt=Date.now();
  }
}
function receiveActionFeedback(next){
  const epoch=next.presentation?.epoch||'';if(feedbackEpoch!==epoch){clearActionFeedback();feedbackEpoch=epoch;}
  const events=feedbackCursor.consume(next,{connected:status==='connected',roomKey:code});
  if(!events.length)return;
  const eligible=!cameraBlocked()&&autoFollow&&!followPaused&&!reducedMotion();
  feedbackCanFollow=feedbackBurst.length?feedbackCanFollow&&eligible:eligible;feedbackBurst.push(...events);feedbackBurst=feedbackBurst.slice(-80);
  if(!feedbackTimer)feedbackTimer=setTimeout(showActionFeedback,180);
}
function hover(text){$('#tile-hint').textContent=text|| (flat?'拖动平移 · 双指或加减键缩放':'拖动旋转 · 双指或滚轮缩放');if(text?.startsWith('相邻落点较近'))toast(text);}
async function select(target){
  if(busy||status!=='connected')return;
  const m=mode();
  if(target.kind==='tile'&&m==='robber')return send({type:'moveRobber',tile:target.id});
  if(target.kind==='edge'&&m==='road')return send({type:'buildRoad',edge:target.id});
  if(target.kind==='vertex'&&['settlement','city'].includes(m))return send({type:m==='city'?'buildCity':'buildSettlement',vertex:target.id});
}
async function send(action){
  if(busy)return;$('#stage-feedback').textContent='';busy=true;render();
  try{await connection.action(action);if(['buildRoad','buildCity','buildSettlement','playDevelopment'].includes(action.type)){selectedBuild='';panel='';cardId='';stagePanel='';$('#stage-dialog').close();}if(['discard','offerTrade','playDevelopment'].includes(action.type)){const prefix={discard:'discard',offerTrade:'give',playDevelopment:'plenty'}[action.type];for(const key of inputDrafts.keys())if(key.startsWith(prefix+'-')||action.type==='offerTrade'&&key.startsWith('want-'))inputDrafts.delete(key);for(const el of document.querySelectorAll(`[id^="${prefix}-"]${action.type==='offerTrade'?', [id^="want-"]':''}`))if(el.matches('input'))el.value='0';}return true;}catch(error){toast(error.message);return false;}finally{busy=false;render();}
}
function connect(room,token,name){
  if(entryError)return toast(entryError);
  try {room=readRoom(room,backendId);}catch(error){return toast(error.message);}
  connection?.close();clearActionFeedback();feedbackEpoch='';followPaused=false;code=room;state=null;seenChatIds=new Set();chatBusy=false;stagePanel='';lastTaskKey='';status='connecting';
  $('#entry-dialog').close();$('#rooms-dialog').close();
  terminalMessage='';storage.set('name',name);replaceViewURL(invitationURL(location.origin,code,backendId));
  connection=new Connection(code,token,name,(next)=>{const old=state;receivedAt=Date.now();if(next.room?.closed)return terminal({type:'closed',message:next.room.closeReason||'房间已关闭。'});if(!old)for(const chat of next.chat)seenChatIds.add(chat.id);state=next;storage.set('last',{code,token,name});storage.set(`token:${code}`,token);if(old?.turnNo!==next.turnNo||old?.phase!==next.phase){selectedBuild='';panel='';cardId='';}render();if(!old)restoreBoardView();receiveActionFeedback(next);},s=>{status=s;if(s!=='connected'){feedbackCursor.consume(state,{connected:false,roomKey:code});clearActionFeedback();}render();},toast,terminal);
  render();
}
async function create(practice=false){
  if(entryError)return toast(entryError);
  const name=$('#nickname')?.value.trim();if(!name)return toast('先给自己起个昵称。');
  const prefix=practice?'practice':'create',playerCount=practice?readCount(prefix):undefined,visibility=$('#create-visibility')?.value||'public',options=readOptions(prefix);
  if(practice&&!playerCount)return toast('请选择练习人数。');
  busy=true;render();const token=newId();
  try{const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,token,practice,playerCount,visibility:practice?'private':visibility,options})});const data=await response.json();if(!response.ok)throw new Error(data.error);$('#practice-dialog').close();connect(data.code,token,name);}catch(error){if(practice)$('#practice-feedback').textContent=error.message;else toast(error.message);}finally{busy=false;render();}
}
function join(){if(entryError)return toast(entryError);const name=$('#nickname').value.trim();if(!name)return toast('先给自己起个昵称。');let room;try{room=readRoom($('#join-code').value,backendId);}catch(error){return toast(error.message);}connect(room,storage.get(`token:${room}`)||newId(),name);}
const statusText=()=>({idle:'',connecting:'正在连接',connected:'已连接',reconnecting:'正在重连',failed:'连接失败',replaced:'座位已在其他页面打开'})[status];
const isHost=()=>state?.me===(state?.room?.hostId||state?.players[0]?.id);
const readCount=prefix=>Number(document.querySelector(`input[name="${prefix}-count"]:checked`)?.value);
const readOptions=prefix=>({...Object.fromEntries(variantOptions.map(v=>[v.key,Boolean($(`#${prefix}-${v.key}`)?.checked)])),...(prefix==='practice'?{playerExpansion:expansionForCount(readCount(prefix))}:{})});
const maxPlayers=()=>state?.phase==='lobby'?6:state?.maxPlayers||state?.profile?.maxPlayers||state?.room?.maxPlayers||4;
const minPlayers=()=>state?.minPlayers||state?.profile?.minPlayers||state?.room?.minPlayers||3;
function optionsFields(prefix,options={},count=options.playerExpansion==='five-six-2025'?6:4){return `${prefix==='practice'?`<fieldset class="count-options"><legend>${prefix==='practice'?'总人数':'人数'}</legend><div class="count-buttons">${[3,4,5,6].map(n=>`<label for="${prefix}-count-${n}"><input id="${prefix}-count-${n}" name="${prefix}-count" data-persist type="radio" value="${n}" ${n===count?'checked':''}><span><b>${n}</b> 人</span></label>`).join('')}</div></fieldset>`:''}<p id="${prefix}-rule-summary" class="rule-match" aria-live="polite"></p><fieldset class="rules-options"><legend>拓展规则 <small>可组合</small></legend><div class="variant-cards">${variantOptions.map(v=>`<label class="variant-card" for="${prefix}-${v.key}"><input id="${prefix}-${v.key}" data-persist type="checkbox" ${options[v.key]?'checked':''}>${icon(v.glyph)}<span><b>${v.name}</b><small>${v.summary}</small></span>${icon('check')}</label>`).join('')}</div></fieldset><p id="${prefix}-compatibility" class="rule-compatibility" role="alert" hidden></p>`;}
function updateRuleSummaries(){
  for(const prefix of ['create','room','practice']){
    const el=$(`#${prefix}-rule-summary`);if(!el)continue;
    const count=prefix==='practice'?readCount(prefix):prefix==='room'?state.players.length:0,options=readOptions(prefix),large=count>4;
    el.textContent=prefix==='create'?`3–6 人入座 · 按开局实际人数自动匹配规则 · ${options.harbormaster?11:10} 分`:`${count} 人 · ${large?'5–6 人扩充 · 大岛屿 · 配对建设':'基础版 · 3–4 人'} · ${options.harbormaster?11:10} 分${prefix==='room'&&count<3?' · 还需 '+(3-count)+' 人':''}`;
    const warning=$(`#${prefix}-compatibility`);warning.hidden=true;warning.textContent='';
    if(prefix==='room')$('#room-settings-form button[type="submit"]').disabled=busy||status!=='connected';
    if(prefix==='practice'){
      $('#practice-seats').innerHTML=`<span>${icon('users')}你 <b>1</b></span><span aria-hidden="true">+</span><span>${icon('bot')}电脑 <b>${count-1}</b></span>`;
      $('#practice-start').disabled=busy;
    }
  }
}
function openPractice(){
  if(entryError)return toast(entryError);
  const name=$('#nickname')?.value.trim();if(!name){toast('先给自己起个昵称。');$('#nickname')?.focus();return;}
  saveDrafts();$('#practice-options').innerHTML=optionsFields('practice',readOptions('create'),readCount('practice')||4);
  for(const [id,value]of inputDrafts){const el=document.getElementById(id);if(el?.closest('#practice-dialog')){if(['checkbox','radio'].includes(el.type))el.checked=value;else el.value=value;}}$('#practice-feedback').textContent='';updateRuleSummaries();$('#practice-dialog').showModal();
}
function roomSettings(){return `<section class="room-settings"><div class="panel-heading"><h2>${isHost()?'房间设置':'本桌规则'}</h2>${button(`${icon('book')}规则`,'rules',false,'text-button')}</div>${isHost()?`<form id="room-settings-form"><label for="room-visibility">房间可见性</label><select id="room-visibility" data-persist><option value="public" ${state.room?.visibility!=='private'?'selected':''}>公开 · 在线列表可见</option><option value="private" ${state.room?.visibility==='private'?'selected':''}>私密 · 邀请码加入</option></select>${optionsFields('room',state.options)}<button type="submit" class="secondary" ${busy||status!=='connected'?'disabled':''}>保存规则 · 重新准备</button></form>`:`<p class="rules-summary">${esc(rulesLabel(state.options))} · ${state.targetPoints||10} 分</p>`}</section>`;}
function playerList(){return `<div class="players">${state.players.map((p,i)=>`<div class="player ${state.phase!=='lobby'&&i===state.turn?'active':''} ${p.id===state.me?'self':''}"><span class="avatar" style="--player:${p.color}">${p.bot?icon('bot'):esc(p.name.slice(0,1))}</span><div class="player-info"><strong>${esc(p.name)}${p.id===state.me?'<small>你</small>':''}${p.id===(state.room?.hostId||state.players[0]?.id)?'<small>房主</small>':''}</strong>${state.phase==='lobby'?`<span>${p.bot?'电脑已准备':p.id===(state.room?.hostId||state.players[0]?.id)?'主持开局':p.ready?'已准备':'未准备'}${!p.online?' · 离线':''}</span>`:`<div class="player-stats"><span aria-label="${p.cards} 张资源" title="资源牌">${icon('cards')}<b>${p.cards}</b></span><span aria-label="${p.developmentCount} 张发展卡" title="发展卡">${icon('development')}<b>${p.developmentCount}</b></span>${state.options?.harbormaster?`<span aria-label="港口分 ${p.harborPoints||0}" title="港口分">${icon('harbor')}<b>${p.harborPoints||0}</b></span>`:''}${!p.online?`<span class="player-offline">${icon('offline')}离线</span>`:''}${i===state.turn?`<span class="player-turn">${icon('arrow')}行动中</span>`:''}</div>`}</div>${state.phase==='lobby'?(isHost()&&p.id!==state.me?`<div class="player-management">${p.bot?`<button class="remove-bot" data-remove-bot="${p.id}" aria-label="移除电脑 ${esc(p.name)}">×</button>`:`<button data-transfer="${p.id}" aria-label="转交房主给 ${esc(p.name)}" ${!p.online?'disabled':''}>转交</button><button data-kick="${p.id}" aria-label="移出玩家 ${esc(p.name)}">移出</button>`}</div>`:`<span class="presence ${p.online?'online':''}"></span>`):`<div class="score" aria-label="${p.points} 分"><b>${p.points}</b><small>分</small></div>`}</div>`).join('')}</div>`;}
function homePanel(){const last=storage.get('last'),disabled=busy||Boolean(entryError);return `${entryError?`<p class="entry-error" role="alert">${esc(entryError)} <a href="/">返回当前服务器首页</a></p>`:''}${terminalMessage?`<p class="room-outcome" role="status">${esc(terminalMessage)}</p>`:''}<div class="home-intro"><h1>一起，开拓这座岛。</h1><p>收获 · 交易 · 建设</p></div><form id="entry-form"><label for="nickname">你的昵称</label><input id="nickname" data-persist autocomplete="nickname" maxlength="16" placeholder="怎么称呼你" value="${esc(storage.get('name')||'')}" required><div class="join-row"><input id="join-code" data-persist aria-label="6 位房间码或带服务器前缀的邀请码" autocomplete="off" maxlength="8" placeholder="房间码 / A-或C-前缀" value="${esc(invite?displayCode(invite):'')}"><button type="submit" ${disabled?'disabled':''}>加入房间</button></div><div class="create-heading"><h2>开一桌</h2><select id="create-visibility" data-persist aria-label="房间可见性"><option value="public">公开房</option><option value="private">私密房</option></select></div><section class="create-options" aria-label="人数与拓展规则">${optionsFields('create')}</section><button type="button" id="create-room" class="primary large" ${disabled?'disabled':''}>${busy?'正在准备岛屿…':'创建好友房间'}${icon('arrow')}</button></form><div class="practice-entry">${button(`${icon('bot')}人机练习`,'practice',disabled,'secondary')}<span>1 位玩家 + 电脑 · 不公开</span></div>${last?button(`原身份返回 ${esc(displayCode(last.code))} ${icon('arrow')}`,'resume',disabled,'resume-button'):''}<div class="home-bottom"><a href="https://github.com/Jack15678/catan-friends" target="_blank" rel="noopener noreferrer">原作 Jack15678 · 个人非商业娱乐</a></div>`;}
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
function retention(){const room=state?.room;if(!room)return '';const remaining=remainingTime(room.expiresAt,room.serverNow,receivedAt);return `<section class="retention-notice ${remaining?'has-deadline':''}" role="status"><strong>${room.paused?'房主已暂停对局':room.practice?'个人练习房':room.visibility==='private'?'私密房间':'公开房间'}</strong><p id="room-retention">${remaining?`${room.practice?'练习房离线保留':room.retentionReason==='paused'?'本次暂停固定期限':'房主离线保留'} · 剩余 ${remaining}，到期后房间关闭并清理。`:room.practice?'练习房离线后保留 10 分钟，暂停不延长期限。':room.paused?'等待房主恢复。首次离线后固定保留最多 4 小时。':'房主在线时保留房间；对局中断线可用原身份返回。'}</p></section>`;}
function roomNavigation(){return `<div class="room-navigation">${isHost()&&state.phase!=='lobby'&&state.phase!=='finished'&&!state.room?.paused?button('暂停对局','pauseGame',busy||status!=='connected','secondary'):''}${isHost()&&state.phase!=='lobby'&&!state.room?.practice&&state.players.some(p=>p.id!==state.me&&!p.bot&&p.online)?button('转交房主','transferMenu',busy,'text-button'):''}${button(state.phase==='lobby'&&!isHost()?'退出座位':'暂离房间','home',busy,'text-button')}${isHost()?button('解散房间','dissolve',busy||status!=='connected','danger-button'):''}</div>`;}
function lobbyControls(){const host=isHost(),disabled=busy||status!=='connected',unready=state.players.some(p=>!p.bot&&p.id!==state.me&&(!p.ready||!p.online));return `<div class="waiting-actions">${button(`${icon('link')}<span>邀请</span>`,'invite',false,'secondary')}${host?button(`${icon('bot')}<span>加电脑</span>`,'addBot',disabled||state.players.length>=6,'secondary'):''}${button(`${icon('settings')}<span>玩法</span>`,'openSettings',false,'secondary')}${host?button(`开始探索 ${icon('arrow')}`,'start',disabled||state.players.length<3||unready,'primary'):button(mine().ready?`${icon('check')}已准备`:'准备好了','ready',disabled,'primary')}</div>`;}
function gamePanel(){
  return `<div class="game-goal">${icon('trophy')}<strong>${state.targetPoints||10}</strong><span>分获胜</span><small>${state.options?.playerExpansion==='five-six-2025'?'配对回合':'基础规则'}</small></div><div class="player-stat-legend">${icon('cards')}资源 ${icon('development')}发展卡${state.options?.harbormaster?`${icon('harbor')}港口分`:''}</div>${playerList()}<div class="awards"><span>${icon('road')}最长道路 <b>${state.longest?esc(state.players.find(p=>p.id===state.longest).name):'待争夺'}</b></span><span>${icon('knight')}最大军队 <b>${state.army?esc(state.players.find(p=>p.id===state.army).name):'待争夺'}</b></span>${state.options?.harbormaster?`<span>${icon('harbor')}卡坦港口 <b>${state.harbormaster?esc(state.players.find(p=>p.id===state.harbormaster)?.name):'待争夺'}</b></span>`:''}</div>`;
}
function gameControls(){
  const me=mine(),active=myTurn(),disabled=busy||status!=='connected'||state.room?.paused;
  return `<section class="build-section" aria-label="建造">${['road','settlement','city','development'].map(k=>{
    const name=({road:'道路',settlement:'村庄',city:'城市',development:'发展卡'})[k];
    const cost=Object.entries(COSTS[k]).map(([r,n])=>`${LABELS[r]} ${n}`).join('，');
    const can=active&&state.phase==='action'&&afford(me.hand,COSTS[k])&&(k==='development'?state.deckCount>0:state.legal[k].length>0);
    return `<button type="button" class="build-button ${selectedBuild===k?'selected':''}" data-build="${k}" aria-label="建造${name}，${cost}" aria-pressed="${selectedBuild===k}" title="${name} · ${cost}" ${!can||disabled?'disabled':''}>${icon(k)}<span>${name}</span></button>`;
  }).join('')}</section><div class="turn-actions">${button(`${icon('trade')}<span>交易</span>`,'trade',disabled||!active||state.phase!=='action','secondary')}${state.phase==='roll'&&active?button(`${icon('dice')}<span>掷骰</span>`,'roll',disabled,'primary'):button(`${icon('arrow')}<span>${state.pairStep==='secondary'?'结束阶段':'结束回合'}</span>`,'endTurn',disabled||!active||state.phase!=='action','primary')}</div>`;
}
function field(r,prefix,max=state?.profile?.resourceCount||19){return `<label class="resource-input ${r}" for="${prefix}-${r}"><span>${icon(r)}${LABELS[r]}</span><input data-persist id="${prefix}-${r}" type="number" inputmode="numeric" min="0" max="${max}" value="0" aria-label="${prefix==='discard'?'弃掉':prefix==='give'?'提供':prefix==='want'?'需要':'获取'}${LABELS[r]}数量"></label>`;}
function formBundle(prefix){return Object.fromEntries(RESOURCES.map(r=>[r,Number($(`#${prefix}-${r}`)?.value||0)]));}
function resourceOptions(selected){return RESOURCES.map(r=>`<option value="${r}" ${r===selected?'selected':''}>${LABELS[r]}</option>`).join('');}
function actionPanel(){
  if(state.room?.paused)return `<section class="choice-panel"><h2>对局已暂停</h2><p>${isHost()?'点击恢复继续原局面。':'等待房主恢复。'}电脑与对局操作已停止，牌局、资源与交易保持原状。</p>${isHost()?button('恢复对局','resumeGame',busy||status!=='connected','primary'):''}</section>`;
  if(state.phase==='discard'&&state.discards[state.me])return `<section class="choice-panel quantity-choice"><h2>放下 ${state.discards[state.me]} 张资源</h2><p>掷出 7 · 选择要弃掉的资源</p><form id="discard-form" data-required-count="${state.discards[state.me]}"><div class="quantity-fields">${RESOURCES.map(r=>field(r,'discard',mine().hand[r])).join('')}</div><div class="decision-submit"><output class="quantity-summary" aria-live="polite">已选 0 / ${state.discards[state.me]} 张</output><button class="primary" ${busy?'disabled':''}>确认弃牌</button></div></form></section>`;
  if(state.phase==='steal'&&myTurn())return `<section class="choice-panel"><h2>选择一位对手</h2><p>随机抽取对方的一张资源牌。</p>${state.legal.victims.map(id=>`<button class="secondary" data-victim="${id}">${esc(state.players.find(p=>p.id===id).name)} ${icon('arrow')}</button>`).join('')}</section>`;
  if(panel==='trade')return `<section class="choice-panel"><div class="panel-heading"><h2>交换资源</h2>${button(icon('close'),'closePanel',false,'square')}</div><form id="bank-form"><label for="bank-give">向银行提供</label><div class="bank-row"><select id="bank-give" data-persist>${resourceOptions('wood')}</select><b id="bank-ratio">4 : 1</b><select id="bank-want" data-persist aria-label="从银行获取">${resourceOptions('wheat')}</select></div><button class="primary" ${busy?'disabled':''}>确认银行交易</button></form>${state.pairStep!=='secondary'?`<form id="trade-form"><h3>向朋友发起交易</h3><div class="offer-columns"><div><b>我提供</b>${RESOURCES.map(r=>field(r,'give',mine().hand[r])).join('')}</div><div><b>我需要</b>${RESOURCES.map(r=>field(r,'want')).join('')}</div></div><button class="secondary" ${busy?'disabled':''}>发布交易请求</button></form>`:'<p class="muted small">配对伙伴建设阶段仅可向银行或港口交易，不能与其他玩家交易。</p>'}</section>`;
  if(panel==='development'&&cardId){const card=mine().dev.find(c=>c.id===cardId);if(!card)return '';return `<section class="choice-panel ${card.type==='plenty'?'quantity-choice':''}"><div class="panel-heading"><h2>${DEV_NAMES[card.type]}</h2>${button(icon('close'),'closePanel',false,'square')}</div>${card.type==='plenty'?'<p>从银行选择共两张资源。</p>':''}<form id="development-form" ${card.type==='plenty'?'data-required-count="2"':''}>${card.type==='plenty'?`<div class="quantity-fields">${RESOURCES.map(r=>field(r,'plenty',state.bank[r])).join('')}</div>`:card.type==='monopoly'?`<label for="monopoly-resource">收取所有对手的哪种资源？</label><select id="monopoly-resource" data-persist>${resourceOptions('ore')}</select>`:`<p>${card.type==='knight'?'移动强盗，并从一位相邻对手手中抽一张资源。':'免费铺设两条道路，仍需连接自己的路网。'}</p>`}<div class="decision-submit">${card.type==='plenty'?'<output class="quantity-summary" aria-live="polite">已选 0 / 2 张</output>':''}<button class="primary" ${busy?'disabled':''}>打出${DEV_NAMES[card.type]}</button></div></form></section>`;}
  return '';
}
function offer(){if(state.room?.paused)return '';const o=state.offer;if(!o)return '';return `<section class="trade-offer"><h3>${esc(state.players.find(p=>p.id===o.from).name)} 想和你交易</h3><div><span>提供</span>${resCost(Object.fromEntries(Object.entries(o.give).filter(([,n])=>n)))}</div><div><span>需要</span>${resCost(Object.fromEntries(Object.entries(o.want).filter(([,n])=>n)))}</div>${o.from===state.me?button('取消交易','cancelTrade',busy,'secondary'):button('接受这笔交易','acceptTrade',busy||!afford(mine().hand,o.want),'primary')}</section>`;}
function unreadChat(){return state?.chat.filter(c=>!seenChatIds.has(c.id)).length||0;}
function rightPanel(){
  if(!state)return publicRooms();
  if(state.phase==='lobby')return `<div class="island-guide"><span class="guide-mark">${icon('island')}</span><h2>从一座村庄开始</h2><div class="resource-legend">${RESOURCES.map(r=>`<span class="${r}" aria-label="${LABELS[r]}" title="${LABELS[r]}">${resourceIllustration(r)}</span>`).join('')}</div><p class="guide-note">收获 · 交易 · 建设</p></div>`;
  return '';
}
function banner(){
  if(state?.phase==='lobby')return `<div class="waiting-banner"><strong>房间 ${esc(displayCode(code))} <small>${state.room?.visibility==='private'?'私密':'公开'}</small></strong><span>${state.players.length} / 6 人 · ${state.players.length>4?'5–6 人扩充 · 配对建设':'基础版 · 3–4 人'}</span><small>${state.players.length<3?`再来 ${3-state.players.length} 人即可开局`:state.players.some(p=>!p.bot&&p.id!==(state.room?.hostId||state.players[0]?.id)&&(!p.ready||!p.online))?'等待朋友在线并准备':'已就绪 · 房主可开始'}${state.options?.friendlyRobber?' · 友善强盗':''}${state.options?.harbormaster?' · 卡坦港口':''}</small></div>`;
  if(!state?.board)return '';
  const p=state.players[state.turn],self=myTurn(),task=requiredTask(state);
  const descriptions={'setup-settlement':'放置村庄','setup-road':'铺设起始道路',roll:'等待掷骰',action:selectedBuild?`选择${{road:'道路',settlement:'村庄',city:'城市'}[selectedBuild]}位置`:state.pairStep==='secondary'?'配对建设阶段':'交易 · 建造',discard:'等待弃牌',robber:'选择强盗地块',steal:'选择偷取对象','road-building':`免费道路 · 还可建 ${state.freeRoads} 条`,finished:'对局结束'};
  const glyph=status!=='connected'?'offline':state.room?.paused?'pause':({'setup-settlement':'settlement','setup-road':'road',roll:'dice',action:selectedBuild||'trade',discard:'cards',robber:'shield',steal:'cards','road-building':'road',finished:'trophy'})[state.phase]||'island';
  return `<div class="turn-banner ${self?'your-turn':''} ${task?'needs-attention':''}"><span class="turn-dot" style="background:${p.color}"></span><div><strong>${state.room?.paused?'对局已暂停':task?task.title:state.phase==='finished'?'对局结束':self?'你的回合':esc(p.name)}</strong><span class="turn-description ${status!=='connected'?'connection-warning':''}">${icon(glyph)}${status!=='connected'?statusText():state.room?.paused?'电脑与操作已停止':task?'需要处理':descriptions[state.phase]||''}</span></div>${state.room?.paused&&isHost()?button('恢复','resumeGame',busy||status!=='connected','task-shortcut'):task?button('去处理','focusTask',false,'task-shortcut'):state.phase==='finished'?button('结算','openResult',false,'task-shortcut'):state.dice?`<div class="dice-pair" role="img" aria-label="骰子 ${state.dice.join(' 加 ')}，合计 ${state.dice.reduce((a,b)=>a+b,0)}">${state.dice.map(n=>`<span title="${n}">${dieFace(n)}</span>`).join('')}<b>${state.dice.reduce((a,b)=>a+b,0)}</b></div>`:''}</div>`;
}
function hand(){if(!state?.board)return '';return `<div class="hand-tray" aria-label="你的资源与手牌"><div class="resource-hand">${RESOURCES.map(r=>`<div class="resource-card ${r}" role="img" aria-label="${LABELS[r]} ${mine().hand[r]} 张" title="${LABELS[r]}：${mine().hand[r]} 张，银行剩余 ${state.bank[r]} 张"><span class="resource-art">${resourceIllustration(r)}</span><strong>${mine().hand[r]}</strong></div>`).join('')}${button(`${icon('development')}<b>${mine().dev.length}</b>`,'openHand',false,'hand-entry')}</div></div>`;}
function tools(){const canPause=isHost()&&state.board&&state.phase!=='finished';return `<div class="stage-primary"><a class="stage-brand" data-home-link href="/" aria-label="卡坦岛好友桌首页" title="卡坦岛">${icon('island')}</a><div id="camera-toolbar" role="group" aria-label="棋盘视角" data-follow-state="${!autoFollow?'off':followPaused?'manual':'following'}">${cameraControls()}</div></div><div class="stage-utilities">${canPause?`<button type="button" class="pause-control ${state.room?.paused?'is-paused':''}" data-action="${state.room?.paused?'resumeGame':'pauseGame'}" aria-label="${state.room?.paused?'恢复对局':'暂停对局'}" title="${state.room?.paused?'恢复对局':'暂停对局'}" ${busy||status!=='connected'?'disabled':''}>${icon(state.room?.paused?'play':'pause')}</button>`:''}${[['chat','openChat','聊天'],['log','openLog','记录'],['settings','openSettings','设置']].map(([glyph,action,label])=>`<button type="button" data-action="${action}" aria-label="${label}" title="${label}" aria-haspopup="dialog">${icon(glyph)}${action==='openChat'&&unreadChat()?`<span class="chat-unread badge">${unreadChat()}</span>`:''}</button>`).join('')}</div>`;}
function playerOrbit(){return state.players.map((p,i)=>`<button type="button" data-player="${esc(p.id)}" class="player-circle ${p.id===state.me?'self':''} ${!p.online?'offline':''}" style="--player:${p.color}" aria-current="${state.phase!=='lobby'&&i===state.turn}" aria-label="${esc(p.name)}${p.id===state.me?'，你':''}，${state.phase==='lobby'?(p.id===(state.room?.hostId||state.players[0]?.id)?'房主':p.bot||p.ready?'已准备':'等待准备'):p.points+' 分'}${state.phase!=='lobby'&&i===state.turn?'，当前行动者':''}${!p.online?'，离线':''}" title="${esc(p.name)}${state.phase!=='lobby'&&i===state.turn?' · 行动中':''}" aria-haspopup="dialog"><span class="circle-face">${p.bot?icon('bot'):esc([...p.name][0])}</span><span class="circle-score">${state.phase==='lobby'?(p.bot||p.ready||p.id===(state.room?.hostId||state.players[0]?.id)?icon('check'):'…'):p.points}</span>${state.phase!=='lobby'&&i===state.turn?`<span class="circle-turn" aria-hidden="true">${icon('arrow')}</span>`:''}${p.id===state.me?'<span class="circle-self">你</span>':''}${!p.online?`<span class="circle-offline" aria-hidden="true">${icon('offline')}</span>`:''}</button>`).join('');}
function playerDetail(){
  const p=state.players.find(p=>p.id===focusedPlayer);if(!p)return gamePanel();
  return `<section class="player-detail"><div class="detail-avatar" style="--player:${p.color}">${p.bot?icon('bot'):esc([...p.name][0])}</div><h3>${esc(p.name)} ${p.id===state.me?'<small>你</small>':''}</h3><p>${state.players[state.turn]?.id===p.id?'当前行动者 · ':''}${p.online?'在线':'离线'}${p.bot?' · 电脑':''}</p><div class="public-stats"><span>${icon('trophy')}<b>${p.points}</b> 分</span><span>${icon('cards')}<b>${p.cards}</b> 资源牌</span><span>${icon('development')}<b>${p.developmentCount}</b> 发展卡</span><span>${icon('knight')}<b>${p.knights||0}</b> 骑士</span></div>${button(`${icon('users')}全部玩家与奖项`,'allPlayers',false,'secondary')}</section>`;
}
function chatMessages(){return state.chat.length?state.chat.map(c=>`<p data-message-id="${esc(c.id)}" class="chat-bubble"><strong>${esc(c.name)}</strong><span>${esc(c.text)}</span><button type="button" class="chat-report" data-report-message="${esc(c.id)}" aria-label="举报消息 ${esc(c.seq)}" title="举报消息 #${esc(c.seq)}">${icon('flag')}<small>#${esc(c.seq)}</small></button></p>`).join(''):`<div class="chat-empty">${icon('chat')}<p>和朋友打声招呼。</p></div>`; }
function chatPanel(){return `<section class="chat-section"><div id="chat-messages" class="chat-log" role="log" aria-label="聊天记录">${chatMessages()}</div><form id="chat-form"><input id="chat-message" data-persist maxlength="200" placeholder="说点什么…" aria-label="聊天消息"><button class="square" aria-label="发送消息" ${chatBusy||status!=='connected'?'disabled':''}>${icon('send')}</button></form><div class="chat-footer">${button(`${icon('shield')}隐私 / 举报`,'report',false,'text-button')}</div></section>`;}
function developmentPanel(){return `<div class="development-hand">${mine().dev.length?mine().dev.map(c=>`<button data-card="${c.id}" ${busy||state.room?.paused||!myTurn()||!['roll','action'].includes(state.phase)||state.playedDev||c.type==='victory'||c.bought>=state.turnNo?'disabled':''} title="${c.type==='victory'?'私下自动计入胜利点':c.bought>=state.turnNo?'本回合购入，下回合可用':'打出这张发展卡'}">${icon(({knight:'knight',roadBuilding:'road',plenty:'wheat',monopoly:'trade',victory:'trophy'})[c.type]||'development')}<span>${DEV_NAMES[c.type]}</span>${c.bought>=state.turnNo&&c.type!=='victory'?'<small>新</small>':''}</button>`).join(''):`<div class="hand-empty">${icon('development')}<p>暂无发展卡</p></div>`}</div><p class="small muted">资源 ${total(mine().hand)} 张 · 胜利点卡私下计分</p><div class="piece-stock" aria-label="剩余棋子">${[['road',15-state.board.edges.filter(e=>e.owner===state.me).length,'道路'],['settlement',5-state.board.vertices.filter(v=>v.owner===state.me&&v.level===1).length,'村庄'],['city',4-state.board.vertices.filter(v=>v.owner===state.me&&v.level===2).length,'城市']].map(([key,n,name])=>`<span aria-label="剩余${name} ${n}" title="剩余${name}">${icon(key)}<b>${n}</b><small>${name}</small></span>`).join('')}</div><div class="bank-stock" aria-label="银行资源"><small>银行</small>${RESOURCES.map(r=>`<span class="${r}" aria-label="银行${LABELS[r]} ${state.bank[r]} 张" title="银行${LABELS[r]}">${icon(r)}<b>${state.bank[r]}</b></span>`).join('')}</div>`;}
function resultPanel(){const winner=state.players.find(p=>p.id===state.winner);return `<section class="winner">${icon('flag')}<h2>${esc(winner?.name)} 获胜</h2><p>${winner?.points} 个胜利点</p>${isHost()?button('再来一局','rematch',busy,'primary'):''}${button('返回首页','home',false,'secondary')}</section>`;}
function stageContent(){
  if(stagePanel==='chat')return chatPanel();
  if(stagePanel==='players')return state.phase==='lobby'?`<p class="rules-summary">${state.players.length} / 6 人 · 电脑与真人均计入开局人数</p>${playerList()}`:playerDetail();
  if(stagePanel==='log')return `<div class="activity-log" aria-label="岛屿记事">${state.log.map(l=>`<p>${esc(l.text)}</p>`).join('')}</div>`;
  if(stagePanel==='settings'&&state.phase==='lobby')return `${roomSettings()}${retention()}${roomNavigation()}`;
  if(stagePanel==='settings')return `<p class="settings-meta"><span class="connection ${status}"><i></i>${statusText()}</span>房间 ${displayCode(code)}</p>${retention()}<p class="rules-summary">${esc(rulesLabel(state.options))} · ${state.targetPoints||10} 分获胜</p><fieldset class="action-preferences"><legend>行动与镜头</legend><label><input id="auto-follow" type="checkbox" ${autoFollow?'checked':''}>${icon('follow')}自动跟随</label><label><input id="reduce-motion" type="checkbox" ${reducedMotion()?'checked':''}>${icon('pause')}减少动态</label><details class="preference-help"><summary>镜头说明</summary><p>拖动或缩放后，点「跟随」恢复。选择落点、输入或打开面板时保持视角。提示随地图位置显示，约 1.25 秒后收起；完整行动可在记录查看。</p></details></fieldset><div class="settings-grid">${button(`${icon('zoom')}放大`,'zoomIn')}${button(`${icon('minus')}缩小`,'zoomOut')}${button(`${icon('reset')}复位`,'reset')}${button(flat?'3D 三维棋盘':'2D 二维棋盘','toggleFlat')}${button(`${icon('book')}玩法指南`,'rules')}${button(`${icon('link')}邀请好友`,'invite')}</div>${button(`${icon('shield')}隐私 / 举报`,'report',false,'text-button')}${roomNavigation()}${lobbyOrigins[backendId]?`<a class="settings-lobby" data-lobby-link href="${lobbyOrigins[backendId]}">返回游戏大厅 ${icon('arrow')}</a>`:''}`;
  if(stagePanel==='hand')return developmentPanel();
  if(stagePanel==='result')return resultPanel();
  const task=requiredTask(state);
  return `<section id="decision-panel" tabindex="-1" aria-label="当前操作">${task?.key.startsWith('offer:')?'':actionPanel()}${offer()}</section>`;
}
function restoreDrafts(){try{const saved=JSON.parse(sessionStorage.getItem(`catan:drafts:${draftScope}`)||'[]');for(const [id,value]of saved)if(typeof id==='string'&&['string','boolean'].includes(typeof value))inputDrafts.set(id,value);}catch{}}
function saveDrafts(){const selector=draftScope==='home'?'#entry-content [data-persist],#practice-dialog [data-persist]':'#left-panel [data-persist],#stage-dialog-content [data-persist]';for(const el of document.querySelectorAll(selector))inputDrafts.set(el.id,['checkbox','radio'].includes(el.type)?el.checked:el.value);try{sessionStorage.setItem(`catan:drafts:${draftScope}`,JSON.stringify([...inputDrafts]));}catch{}}
function openStagePanel(next){saveDrafts();if(stagePanel)panelScroll.set(stagePanel,$('#stage-dialog-content').scrollTop);stagePanel=next;$('#stage-feedback').textContent='';render();}
function closeStagePanel(){saveDrafts();if(stagePanel)panelScroll.set(stagePanel,$('#stage-dialog-content').scrollTop);stagePanel='';$('#stage-dialog').close();paintActionFeedback();syncViewport();}
function renderStage(task){
  const dialog=$('#stage-dialog');
  if(!state){stagePanel='';dialog.close();lastTaskKey='';renderStage.phase='';return;}
  if(state.phase==='lobby'&&renderStage.phase&&renderStage.phase!=='lobby'){saveDrafts();stagePanel='';lastTaskKey='';}
  const taskKey=task?.key||'';
  if(taskKey!==lastTaskKey){lastTaskKey=taskKey;if(task){saveDrafts();stagePanel='decision';$('#stage-feedback').textContent='';panelScroll.set('decision',0);}else if(stagePanel==='decision'){stagePanel='';}}
  if(state.phase==='finished'&&renderStage.phase!=='finished')stagePanel='result';
  renderStage.phase=state.phase;
  if(!stagePanel){dialog.close();return;}
  $('#stage-dialog-title').textContent=({chat:'围桌聊聊',players:`本桌玩家 · ${state.players.length} 人`,log:'岛屿记事',settings:'对局设置',hand:'你的手牌',result:'本局结算',decision:task?.title||(panel==='development'?DEV_NAMES[mine().dev.find(c=>c.id===cardId)?.type]||'发展卡':panel==='trade'?'交换资源':'交换与行动')})[stagePanel];
  const scroller=$('#stage-dialog-content'),scroll=scroller.scrollTop,changed=scroller.dataset.panel!==stagePanel;
  if(!changed&&stagePanel==='chat'&&$('#chat-form')){paint('#chat-messages',chatMessages());$('#chat-form button').disabled=chatBusy||status!=='connected';}else paint('#stage-dialog-content',stageContent());
  scroller.dataset.panel=stagePanel;
  scroller.scrollTop=changed?panelScroll.get(stagePanel)||0:scroll;
  if(stagePanel==='chat')for(const chat of state.chat)seenChatIds.add(chat.id);
  if(!dialog.open&&!$('#room-dialog').open&&!$('#rules-dialog').open){$('#toast').classList.remove('show');dialog.showModal();}
}
function render(){
  const oldChat=$('#chat-messages'),chatScroll=oldChat?.scrollTop||0,followChat=!oldChat||oldChat.scrollHeight-oldChat.clientHeight-chatScroll<32;
  const detailsState=new Map([...document.querySelectorAll('details[id]')].map(el=>[el.id,el.open]));
  const nextScope=state?.me&&code?`${backendId}:${code}:${state.me}`:'home';
  if(nextScope!==draftScope){saveDrafts();inputDrafts.clear();draftScope=nextScope;restoreDrafts();paint('#stage-dialog-content','');$('#stage-dialog-content').dataset.panel='';}else saveDrafts();
  const activeElement=document.activeElement,active=activeElement?.id,start=activeElement?.selectionStart;
  const task=requiredTask(state);
  $('#table').className=`table ${state?'in-room':'home'} ${state?'playing':''} ${state?.phase==='lobby'?'waiting':''} ${task?'has-required-task':''} ${panel?'has-open-panel':''}`;
  $('#board').setAttribute('aria-busy',String(busy||Boolean(code)&&status!=='connected'));
  document.body.classList.toggle('at-table',Boolean(state));
  document.body.classList.toggle('at-home',!state);
  document.body.classList.toggle('reduced-action-motion',reducedMotion());
  paint('#room-meta',code?`<span class="connection ${status}"><i></i>${statusText()}</span><span class="room-code">房间 ${displayCode(code)}</span>${button(`${icon('link')}<span>邀请好友</span>`,'invite',false,'text-button')}${state?button(icon('back'),'home',false,'square'):button('取消连接','home',false,'text-button')}`:'<span class="header-note">把朋友聚在一张桌上</span>');
  paint('#left-panel','');
  if(!state){paint('#entry-content',homePanel());paint('#rooms-content',publicRooms());}
  else {$('#entry-dialog').close();$('#rooms-dialog').close();}
  paint('#play-dock',state?.phase==='lobby'?lobbyControls():state?.board?gameControls():'');
  paint('#right-panel',state?rightPanel():'');paint('#turn-banner',banner());paint('#hand',hand());renderStage(task);paint('#stage-tools',state?tools():'');
  paint('#player-orbit',state?playerOrbit():'');
  $('#home-dock').hidden=Boolean(state);
  document.querySelector('[data-action=closeStagePanel]').setAttribute('aria-label','关闭面板');
  document.querySelector('[data-action=trade]')?.setAttribute('aria-label','资源交易');
  document.querySelector('[data-action=roll]')?.setAttribute('aria-label','掷出骰子');
  document.querySelector('[data-action=toggleFlat]')?.setAttribute('aria-label',flat?'切换三维棋盘':'切换二维棋盘');
  for(const el of document.querySelectorAll('[data-action=reset]'))el.setAttribute('aria-label','复位棋盘视角');
  document.querySelector('[data-action=openHand]')?.setAttribute('aria-label',`你的手牌，${mine()?.dev.length||0} 张发展卡`);
  document.querySelector('#room-meta [data-action="home"]')?.setAttribute('aria-label','返回首页');
  document.querySelector('[data-action="closePanel"]')?.setAttribute('aria-label','关闭操作面板');
  paint('#island-caption',state?.board?'':`<strong>卡坦岛</strong><span>从一座村庄开始</span>`);
  for(const [id,value] of inputDrafts){const el=document.getElementById(id);if(el&&el!==activeElement){if(['checkbox','radio'].includes(el.type))el.checked=value;else el.value=value;}}
  updateRuleSummaries();
  for(const [id,open] of detailsState){const el=document.getElementById(id);if(el)el.open=open;}
  if(active){const el=document.getElementById(active);if(el&&el!==activeElement){el.focus({preventScroll:true});if(start!=null && ['text','search'].includes(el.type))try{el.setSelectionRange(start,start);}catch{}}}
  // Measure the new HUD before the first island fit, including reduced-motion
  // sessions whose later notice padding must preserve their settled camera.
  syncViewport();board?.set(sceneState(),mode());
  if(cameraBlocked()){feedbackCanFollow=false;board?.cancelFocus?.();}
  updateAmbient();paintActionFeedback();
  for(const el of document.querySelectorAll('.activity-log'))el.scrollTop=el.scrollHeight;
  if($('#chat-messages'))$('#chat-messages').scrollTop=followChat?$('#chat-messages').scrollHeight:chatScroll;
  bindForms();updateRatio();
  document.querySelector('[data-action="confirmRoomDialog"]').disabled=busy;
  syncViewport();
}
function updateAmbient(){board?.setAmbient?.(!state&&!document.hidden&&!document.querySelector('dialog[open]'),{reducedMotion:reducedMotion()});}
function paint(selector,markup){const el=$(selector);if(el._markup!==markup){el.innerHTML=markup;el._markup=markup;}}
function updateRatio(){if($('#bank-ratio'))$('#bank-ratio').textContent=`${ownRatio($('#bank-give').value)} : 1`;}
function bindQuantityForms(){
  for(const form of document.querySelectorAll('form[data-required-count]')){
    const update=()=>{
      const required=Number(form.dataset.requiredCount),inputs=[...form.querySelectorAll('input[type="number"]')],selected=inputs.reduce((n,input)=>n+Number(input.value||0),0);
      const valid=inputs.every(input=>input.checkValidity())&&Number.isInteger(selected)&&selected===required;
      const output=form.querySelector('.quantity-summary');output.textContent=`已选 ${selected} / ${required} 张`;output.classList.toggle('complete',valid);
      form.querySelector('button.primary').disabled=busy||status!=='connected'||!valid;
    };
    form.oninput=update;update();
  }
}
function bindForms(){
  $('#practice-form').onsubmit=e=>{e.preventDefault();if(!busy)create(true);};
  if($('#room-settings-form'))$('#room-settings-form').onsubmit=e=>{e.preventDefault();const options=readOptions('room');send({type:'configure',visibility:$('#room-visibility').value,options});};
  if($('#entry-form'))$('#entry-form').onsubmit=e=>{e.preventDefault();join();};if($('#create-room'))$('#create-room').onclick=()=>create();
  if($('#discard-form'))$('#discard-form').onsubmit=e=>{e.preventDefault();send({type:'discard',cards:formBundle('discard')});};
  if($('#bank-form'))$('#bank-form').onsubmit=e=>{e.preventDefault();send({type:'bankTrade',give:$('#bank-give').value,want:$('#bank-want').value});};
  if($('#bank-give'))$('#bank-give').onchange=updateRatio;
  if($('#trade-form'))$('#trade-form').onsubmit=e=>{e.preventDefault();send({type:'offerTrade',give:formBundle('give'),want:formBundle('want')});};
  if($('#chat-form'))$('#chat-form').onsubmit=sendChat;
  if($('#development-form'))$('#development-form').onsubmit=e=>{e.preventDefault();send({type:'playDevelopment',cardId,cards:formBundle('plenty'),resource:$('#monopoly-resource')?.value});};
  bindQuantityForms();
}
document.addEventListener('click',async e=>{
  const nav=e.target.closest('a[data-lobby-link],a[data-home-link]');if(nav&&code){e.preventDefault();openLeave(nav.hasAttribute('data-lobby-link')?'lobby':'home');return;}
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.player){focusedPlayer=b.dataset.player;return openStagePanel('players');}
  if(b.dataset.reportMessage){const message=state?.chat.find(message=>message.id===b.dataset.reportMessage);return openReport(message);}
  if(b.dataset.build){if(b.dataset.build==='development')return send({type:'buyDevelopment'});selectedBuild=selectedBuild===b.dataset.build?'':b.dataset.build;panel='';return render();}
  if(b.dataset.listRoom){const room=b.dataset.listRoom,name=$('#nickname')?.value.trim()||storage.get('name');if(!name){$('#rooms-dialog').close();$('#entry-dialog').showModal();$('#join-code').value=displayCode(room);saveDrafts();$('#nickname')?.focus({preventScroll:true});toast('填写昵称后即可加入已选房间。');return;}return connect(room,storage.get(`token:${room}`)||newId(),name);}
  if(b.dataset.kick)return openConfirmation({type:'kick',playerId:b.dataset.kick},'移出玩家',`将 ${state.players.find(p=>p.id===b.dataset.kick)?.name||'该玩家'} 移出等待房间？对方席位及原身份将失效。`,'确认移出');
  if(b.dataset.transfer)return openConfirmation({type:'transferHost',playerId:b.dataset.transfer},'转交房主',`将房主权限交给 ${state.players.find(p=>p.id===b.dataset.transfer)?.name||'该玩家'}？你的座位保留，解散与房间设置权限会立即转移。`,'确认转交');
  if(b.dataset.removeBot)return send({type:'removeBot',playerId:b.dataset.removeBot});
  if(b.dataset.victim)return send({type:'steal',victim:b.dataset.victim});
  if(b.dataset.card){cardId=b.dataset.card;panel='development';return openStagePanel('decision');}
  const action=b.dataset.action;
  if(action==='openEntry'){saveDrafts();$('#entry-dialog').showModal();return;}
  if(action==='closeEntry'){$('#entry-dialog').close();return;}
  if(action==='openRooms'){$('#rooms-dialog').showModal();return;}
  if(action==='closeRooms'){$('#rooms-dialog').close();return;}
  if(action==='homePractice'){
    if(!$('#nickname')?.value.trim()){$('#entry-dialog').showModal();$('#nickname').focus({preventScroll:true});return toast('填写昵称后，点「人机练习」选择人数。');}
    return openPractice();
  }
  if(action==='allPlayers'){focusedPlayer='';return render();}
  if(action==='report')return openReport();
  if(action==='closeReport')return $('#report-dialog').close();
  if(action==='focusTask'){openStagePanel('decision');$('#decision-panel')?.focus({preventScroll:true});return;}
  const stageActions={openChat:'chat',openPlayers:'players',openLog:'log',openSettings:'settings',openHand:'hand',openResult:'result'};
  if(stageActions[action]){if(action==='openPlayers')focusedPlayer='';return openStagePanel(stageActions[action]);}
  if(action==='closeStagePanel')return closeStagePanel();
  if(action==='toggleFollow'){if(!autoFollow||followPaused){autoFollow=true;followPaused=false;}else autoFollow=false;storage.set('auto-follow',autoFollow);board?.cancelFocus?.();paintCameraControls();saveBoardView();return;}
  if(action==='overview'){pauseFollowing();return board.reset();}
  if(action==='ready')return send({type:'ready',ready:!mine().ready});
  if(action==='refreshRooms')return refreshRooms();
  if(action==='loadMoreRooms')return refreshRooms(true);
  if(action==='transferMenu'){openConfirmation({type:'chooseTransfer'},'转交房主','转交后你的座位保留，房主权限与房间离线保留期归新房主管理。','确认转交');$('#room-dialog-copy').insertAdjacentHTML('beforeend',`<label for="transfer-choice">选择在线玩家</label><select id="transfer-choice">${state.players.filter(p=>p.id!==state.me&&!p.bot&&p.online).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>`);return;}
  if(action==='pauseGame')return openConfirmation({type:'pause'},'暂停对局',state.room?.practice?'暂停后电脑和对局操作停止，原局面保留。练习房离线后仍保留 10 分钟。':'暂停后电脑和对局操作停止。本次暂停首次离线起固定保留最多 4 小时，短暂重连不延长期限。','确认暂停');
  if(action==='resumeGame')return send({type:'resume'});
  if(action==='dissolve')return openConfirmation({type:'close'},'解散房间','解散会结束所有成员的房间，旧邀请、存档与重连都不能恢复。此操作与暂离不同。','确认解散');
  if(action==='cancelRoomDialog'){confirmation=null;$('#room-dialog').close();return render();}
  if(action==='confirmRoomDialog')return confirmRoomDialog();
  if(['start','addBot','roll','endTurn','cancelTrade','rematch'].includes(action))return send({type:action});
  if(action==='acceptTrade')return send({type:'acceptTrade',offerId:state.offer.id});
  if(action==='rules'){saveDrafts();return $('#rules-dialog').showModal();}if(action==='closeRules'){ $('#rules-dialog').close();return render();}
  if(action==='reset'){pauseFollowing();return board.reset();}
  if(action==='zoomIn'||action==='zoomOut')return board.zoomBy(action==='zoomIn'?1.25:.8);
  if(action==='practice')return openPractice();
  if(action==='closePractice')return $('#practice-dialog').close();
  if(action==='trade'){panel='trade';selectedBuild='';return openStagePanel('decision');}
  if(action==='closePanel')return closeStagePanel();
  if(action==='resume'){const last=storage.get('last');if(last)connect(last.code,last.token,last.name);return;}
  if(action==='home')return openLeave('home');
  if(action==='invite'){const link=invitationURL(location.origin,code,backendId);try{await navigator.clipboard.writeText(link);toast('邀请链接已复制，发给朋友即可加入。');}catch{toast(`房间码：${displayCode(code)}。将当前页面地址发给朋友即可。`);}return;}
  if(b.id==='flat-toggle'||action==='toggleFlat'){saveBoardView();flat=!flat;makeBoard();render();saveBoardView();}
});
function forgetIdentity(room){storage.set(`token:${room}`,null);if(storage.get('last')?.code===room)storage.set('last',null);}
function terminal(message){const current=code;forgetIdentity(current);terminalMessage=message.message||(message.type==='removed'?'你已被移出房间，原身份已失效。':'房间已关闭，旧链接不能恢复。');connection?.close();clearActionFeedback();connection=null;state=null;code='';status='idle';invite='';replaceViewURL('/');$('#room-dialog').close();confirmation=null;render();refreshRooms();}
function exitView(destination){saveBoardView();connection?.close();clearActionFeedback();connection=null;state=null;code='';status='idle';selectedBuild='';panel='';invite='';replaceViewURL('/');if(destination==='lobby'){const target=gameLobbyURL(backendId);if(target){location.assign(target);return;}}render();refreshRooms();}
function openConfirmation(task,title,description,confirmText='确认'){confirmation=task;$('#room-dialog-title').textContent=title;$('#room-dialog-copy').textContent=description;document.querySelector('[data-action="confirmRoomDialog"]').textContent=confirmText;$('#room-dialog').showModal();}
function openLeave(destination){if(!code)return exitView(destination);const description=state?leaveDescription({lobby:state.phase==='lobby',host:isHost(),practice:state.room?.practice,paused:state.room?.paused,target:destination==='lobby'?'游戏大厅':'首页'}):`取消连接并返回${destination==='lobby'?'当前服务器游戏大厅':'首页'}。`;openConfirmation({type:'navigate',destination},state?.phase==='lobby'&&!isHost()?'退出座位':'暂离房间',description,state?.phase==='lobby'&&!isHost()?'退出并返回':'暂离并返回');}
async function confirmRoomDialog(){let task=confirmation;if(task?.type==='chooseTransfer')task={type:'transferHost',playerId:$('#transfer-choice')?.value};if(!task||busy)return;$('#room-dialog').close();confirmation=null;if(task.type==='navigate'){const release=state?.phase==='lobby'&&!isHost(),current=code;if(state&&!(state.phase==='lobby'&&isHost())&&!(await send({type:'leave'})))return;if(release)forgetIdentity(current);return exitView(task.destination);}await send(task);}
setInterval(()=>{const el=$('#room-retention'),room=state?.room;if(el&&Number.isFinite(room?.expiresAt)){const remaining=remainingTime(room.expiresAt,room.serverNow,receivedAt);el.textContent=`${room.practice?'练习房离线保留':room.retentionReason==='paused'?'本次暂停固定期限':'房主离线保留'} · 剩余 ${remaining}，到期后房间关闭并清理。`;}},1000);
function syncViewport(){
  const viewport=window.visualViewport;
  document.documentElement.style.setProperty('--visual-height',`${viewport?.height||innerHeight}px`);
  document.documentElement.style.setProperty('--visual-top',`${viewport?.offsetTop||0}px`);
  document.documentElement.style.setProperty('--app-height',`${innerHeight}px`);
  if(state){
    const table=$('#table'),css=getComputedStyle(table),usableWidth=innerWidth-(parseFloat(css.paddingLeft)||0)-(parseFloat(css.paddingRight)||0);
    table.classList.toggle('compact-hud',usableWidth<630);table.classList.toggle('stacked-hud',usableWidth<548);
    const top=Math.max(...['#stage-tools','#turn-banner','#player-orbit'].map(selector=>{const el=$(selector);return el&&!el.hidden&&el.getClientRects().length?el.getBoundingClientRect().bottom+10:0;}));
    const bottom=Math.max(...['#hand .hand-tray','#play-dock'].map(selector=>{const el=$(selector);return el&&el.getClientRects().length?innerHeight-el.getBoundingClientRect().top+10:0;}));
    board?.setViewportPadding?.({top:Math.max(top,(parseFloat(css.getPropertyValue('--board-pad-top'))||0)+(parseFloat(css.paddingTop)||0)),bottom:Math.max(bottom,(parseFloat(css.getPropertyValue('--board-pad-bottom'))||0)+(parseFloat(css.paddingBottom)||0)),left:12+(parseFloat(css.paddingLeft)||0),right:12+(parseFloat(css.paddingRight)||0)},{preserveView:Boolean(actionFeedback)});
  }else if(!state){const header=$('.topbar').getBoundingClientRect(),dock=$('#home-dock').getBoundingClientRect();board?.setViewportPadding?.({top:header.bottom+8,right:12,bottom:innerHeight-dock.top+10,left:12});}
  else board?.setViewportPadding?.({top:0,right:0,bottom:0,left:0});
  positionActionFeedback();
}
window.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('resize',syncViewport);window.visualViewport?.addEventListener('scroll',syncViewport);
document.addEventListener('focusin',()=>{if(cameraBlocked()){feedbackCanFollow=false;board?.cancelFocus?.();}paintActionFeedback();syncViewport();});document.addEventListener('focusout',()=>requestAnimationFrame(()=>{paintActionFeedback();syncViewport();}));
document.addEventListener('pointerdown',e=>{feedbackCanFollow=false;if(!e.target.closest('#board'))board?.cancelFocus?.();},true);
document.addEventListener('change',e=>{
  if(e.target.closest('.count-options,.rules-options')){saveDrafts();updateRuleSummaries();}
  if(e.target.id==='auto-follow'){autoFollow=e.target.checked;followPaused=false;storage.set('auto-follow',autoFollow);board?.cancelFocus?.();paintCameraControls();}
  if(e.target.id==='reduce-motion'){motionPreference=e.target.checked;storage.set('reduce-motion',motionPreference);document.body.classList.toggle('reduced-action-motion',reducedMotion());board?.cancelFocus?.();board?.setFeedback?.(actionFeedback,{reducedMotion:reducedMotion()});updateAmbient();}
});
motionQuery.addEventListener('change',()=>{document.body.classList.toggle('reduced-action-motion',reducedMotion());board?.cancelFocus?.();board?.setFeedback?.(actionFeedback,{reducedMotion:reducedMotion()});updateAmbient();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearActionFeedback();board?.cancelFocus?.();}updateAmbient();});
$('#rules-dialog').addEventListener('close',()=>{if(stagePanel)render();else paintActionFeedback();});
$('#room-dialog').addEventListener('close',()=>{if(stagePanel)render();else paintActionFeedback();});
$('#stage-dialog').addEventListener('cancel',e=>{e.preventDefault();closeStagePanel();});
replaceViewURL=installDialogDismissal({beforeClose:saveDrafts,onStageClose:closeStagePanel,onChange:updateAmbient,canDismiss:dialog=>dialog.id!=='stage-dialog'||stagePanel!=='decision'||!requiredTask(state)||state.room?.paused}).replaceURL;
restoreDrafts();makeBoard();render();syncViewport();
document.addEventListener('input',event=>{if(event.target.matches('[data-persist]'))saveDrafts();});
document.addEventListener('change',event=>{if(event.target.matches('[data-persist]'))saveDrafts();});
const hudObserver=new ResizeObserver(syncViewport);for(const selector of ['#stage-tools','#turn-banner','#player-orbit','#home-dock','#hand','#play-dock'])hudObserver.observe($(selector));
window.addEventListener('pagehide',()=>{saveDrafts();saveBoardView();clearActionFeedback();});
if(!entryError)refreshRooms();
const last=storage.get('last');if(!entryError&&invite&&last?.code===invite)connect(last.code,last.token,last.name);
window.addEventListener('online',()=>{if(connection&&!connection.stopped&&connection.ws.readyState>1){clearTimeout(connection.reconnectTimer);connection.connect();}});
