import { ChatPreview } from './chat-preview.js';
import './chat-preview.css';
import { DOMESTIC, SITE_EDITION } from './site-config.js';
import { NICKNAMES, randomNickname } from '../shared/site-policy.js';
import './style.css';
import './table.css';
import './entry.css';
import './map-first.css';
import './immersive-polish.css';
import './home-family.css';
import './home-showcase.css';
import './visual-first.css';
import './commerce.css';
import {buildAvailability,normalizeTradeDraft} from './commerce.js';
import {renderUI} from './ui/root';
import { Board, FlatBoard } from './board.js';
import { Connection } from './connection.js';
import { newId } from './id.js';
import { readRoom, readInvitation, invitationURL, lobbyOrigins } from './invitation.js';
import { createBoard, RESOURCES } from '../shared/board.js';
import { DEV_NAMES } from '../shared/game.js';
import { variantOptions, remainingTime, gameLobbyURL, leaveDescription, mergeRoomPages, expansionForCount } from './room-ui.js';
import { requiredTask } from './table-layout.js';
import { NoticeQueue } from './notice-queue.js';
import { ActionFeedbackCursor, mergeFeedbackEvents } from './action-feedback.js';
import { installDialogDismissal } from './dialogs.js';
import { placeMapBubble, BubbleVisibility } from './map-bubble.js';
import { createHomeExample, homePadding } from './home-showcase.js';
import './notices.css';

const $=s=>document.querySelector(s);
const storage={get(key){try{return JSON.parse(localStorage.getItem(`catan:${key}`));}catch{return null;}},set(key,value){try{localStorage.setItem(`catan:${key}`,JSON.stringify(value));}catch{}}};
let state=null,connection=null,code='',status='idle',busy=false,selectedBuild='',panel='',cardId='',flat=false,board;
let seenChatIds=new Set(),chatBusy=false,chatAttempt=null,reportInfo=null,reportContext='';
const chatPreview=DOMESTIC?null:new ChatPreview(()=>openStagePanel('chat'),chatMapObstacles);
let roomList={status:'loading',rooms:[],error:'',nextCursor:null,moreStatus:'idle',moreError:''},listRequest=0,terminalMessage='',receivedAt=Date.now(),confirmation=null;
let previewSeed=17;const preview={board:createBoard(()=>{previewSeed=(previewSeed*1664525+1013904223)>>>0;return previewSeed/4294967296;}),players:[],robber:null,legal:{}};
const largePreview={...preview,board:createBoard(undefined,{playerExpansion:'five-six-2025'})};
const homeExample=createHomeExample();
const sceneState=()=>state?.board?state:state?state.players.length>4?largePreview:preview:code?preview:homeExample;
let showcaseInterrupted=false,pageAway=false;
let stagePanel='', focusedPlayer='';
let inspectedBuild='',selectedPort=null,tradeView='players',tradePage='compose';
const savedBoardViews=new Map();
const feedbackCursor=new ActionFeedbackCursor(), motionQuery=matchMedia('(prefers-reduced-motion:reduce)');
let autoFollow=storage.get('auto-follow')!==false, followPaused=false, motionPreference=storage.get('reduce-motion');
let feedbackVisibility=new BubbleVisibility(),feedbackRevealTimer=0;
let actionFeedback=null, feedbackPlacement=null, lastCameraAt=0, feedbackEpoch='', feedbackCanFollow=false;
const feedbackQueue=new NoticeQueue({show:showActionFeedback,delay:180,key:event=>event.id,pendingLimit:80,merge:(events,omitted)=>{const event=mergeFeedbackEvents(events);event.count+=omitted;return event;},duration:event=>Math.min(5200,Math.max(2800,event.text.length*65))});
const toastQueue=new NoticeQueue({show:paintToast,duration:text=>Math.min(6500,Math.max(3200,text.length*80))});
const reducedMotion=()=>typeof motionPreference==='boolean'?motionPreference:motionQuery.matches;
const inputDrafts=new Map(), panelScroll=new Map();
let draftScope='home';
let viewSaveTimer=0;
let lastTaskKey='',stagePhase='',practiceOptions={},practiceCount=4,confirmationCopy=null;
let selectedNickname=DOMESTIC?(NICKNAMES.find(n=>n.id===storage.get('nicknameId'))||randomNickname()):null;
if(DOMESTIC){storage.set('name',null);const last=storage.get('last');if(last)storage.set('last',{...last,name:undefined});for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith('catan:drafts:')){try{const safe=JSON.parse(sessionStorage.getItem(key)||'[]').filter(([id,value])=>/^(give|want)-(wood|brick|sheep|wheat|ore)$/.test(id)&&/^\d+$/.test(value)||/^bank-(give|want)$/.test(id)&&RESOURCES.includes(value));sessionStorage.setItem(key,JSON.stringify(safe));}catch{sessionStorage.removeItem(key);}}}}
const entryNickname=()=>DOMESTIC?selectedNickname.id:$('#nickname')?.value.trim();
let backendId='local',invite='',entryError='';
let replaceViewURL=url=>history.replaceState(null,'',url);
try {
  const response=await fetch('/api/deployment',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('暂时无法确认当前服务器，请刷新后重试。');
  const deployment=await response.json();
  if(deployment.siteEdition!==SITE_EDITION||deployment.game!=='catan-friends'||!['local','aliyun','cloudflare'].includes(deployment.backendId)||deployment.publicOrigin&&deployment.publicOrigin!==location.origin)throw new Error('服务器配置与当前入口不一致，请联系维护者。');
  backendId=deployment.backendId;invite=readInvitation(location.search,backendId);
}catch(error){entryError=error.message;roomList={...roomList,status:'error',error:'入口校验未通过，无法读取当前服务器房间列表。'};}
const displayCode=value=>backendId==='aliyun'?`A-${value}`:backendId==='cloudflare'?`C-${value}`:value;
const mine=()=>state?.players.find(p=>p.id===state.me);
const myTurn=()=>state && state.players[state.turn]?.id===state.me;

function paintToast(text){
  const el=$('#toast');if(!el)return;
  if(text===null){el.classList.remove('show');el.hidePopover?.();return;}
  el.textContent=text;el.showPopover?.();el.classList.add('show');
}
function toast(text){if(typeof text==='string'&&text.trim())toastQueue.push(text.trim());}
async function sendChat(event){
  event.preventDefault();
  if(DOMESTIC)return;
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
function renderReport(){render();}
async function openReport(message){if(DOMESTIC)return;
  reportContext=message?`${message.name} · ${new Date(message.sentAt).toLocaleString('zh-CN',{hour12:false})} · ${message.text}`:'';
  reportInfo=null;renderReport();if(!$('#report-dialog').open)$('#report-dialog').showModal();
  try{const response=await fetch('/api/security/contact',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error();reportInfo=await response.json();}
  catch{reportInfo={failed:true};}
  renderReport();
}
function mode(){if(!state||!myTurn()||state.room?.paused)return '';if(state.phase==='setup-settlement')return 'settlement';if(['setup-road','road-building'].includes(state.phase))return 'road';if(state.phase==='robber')return 'robber';return state.phase==='action'?selectedBuild:'';}
function makeBoard(){if(board&&state?.board)savedBoardViews.set(board instanceof FlatBoard,board.exportView?.());board?.dispose();$('#board').innerHTML='';try{board=flat?new FlatBoard($('#board'),select,hover):new Board($('#board'),select,hover);}catch(error){flat=true;board=new FlatBoard($('#board'),select,hover);toast('当前设备无法开启 3D，已切换到二维棋盘。');}board.onManual=()=>{if(!state&&!code){showcaseInterrupted=true;updateAmbient();}else pauseFollowing();};board.onProjectionChange=()=>{chatPreview?.position();positionActionFeedback();if(state?.board&&!viewSaveTimer)viewSaveTimer=setTimeout(saveBoardView,120);};$('#flat-toggle').textContent=flat?'3D':'2D';$('#flat-toggle').setAttribute('aria-label',flat?'切换三维棋盘':'切换二维棋盘');syncViewport();board.set(sceneState(),mode());if(state?.board&&!board.importView?.(storedBoardView()))board.importView?.(savedBoardViews.get(flat));board.setFeedback?.(actionFeedback,{reducedMotion:reducedMotion()});positionActionFeedback();}
function storedBoardView(){if(!state?.board||!code)return null;try{return JSON.parse(sessionStorage.getItem(`catan:view:${backendId}:${code}:${state.me}:${flat}`)||'null');}catch{return null;}}
function saveBoardView(){clearTimeout(viewSaveTimer);viewSaveTimer=0;if(!state?.board||!code)return;try{sessionStorage.setItem(`catan:view:${backendId}:${code}:${state.me}:${flat}`,JSON.stringify({...board.exportView?.(),followPaused}));sessionStorage.setItem(`catan:renderer:${backendId}:${code}:${state.me}`,JSON.stringify(flat));}catch{}}
function restoreBoardView(){if(!state?.board)return;try{const preference=JSON.parse(sessionStorage.getItem(`catan:renderer:${backendId}:${code}:${state.me}`)||'null');if(typeof preference==='boolean'&&preference!==flat){flat=preference;makeBoard();render();}const view=JSON.parse(sessionStorage.getItem(`catan:view:${backendId}:${code}:${state.me}:${flat}`)||'null');if(board.importView?.(view)){followPaused=Boolean(view.followPaused??view.viewMode==='manual');paintCameraControls();}}catch{}}
function paintCameraControls(){render();}
function pauseFollowing(){followPaused=true;feedbackCanFollow=false;board?.cancelFocus?.();paintCameraControls();saveBoardView();}
function cameraBlocked(){return !state?.board||status!=='connected'||busy||Boolean(mode())||Boolean(state.room?.paused)||Boolean(document.querySelector('dialog[open]'))||Boolean(document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))||document.hidden;}
function clearActionFeedback(){feedbackCanFollow=false;feedbackQueue.clear();}
function positionActionFeedback(){
  const el=$('#action-feedback'),leader=$('#action-feedback-leader');leader?.setAttribute('hidden','');
  if(!actionFeedback||el.hidden)return;
  if(document.querySelector('dialog[open]')){el.style.visibility='hidden';return;}
  const target=actionFeedback.bubbleTarget,point=target?board?.projectFeedbackTarget?.(target):null,bounds=$('#board').getBoundingClientRect();
  let x,y;
  if(target){
    el.dataset.target=`${target.kind}:${target.id}`;
    if(!point?.visible){feedbackVisibility.update(false,performance.now());el.style.visibility='hidden';return;}x=point.x;y=point.y;
  }else{
    const actor=document.querySelector(`[data-player="${CSS.escape(actionFeedback.actorId)}"]`),anchor=actor||$('#play-dock'),r=anchor?.getBoundingClientRect();if(!r){el.style.visibility='hidden';return;}
    x=r.left+r.width/2-bounds.left;y=r.bottom-bounds.top+12;el.dataset.target=actor?`actor:${actionFeedback.actorId}`:'controls';
  }
  const obstacles=[...document.querySelectorAll('.stage-primary,.stage-utilities,#player-orbit,#play-dock,.hand-tray,#turn-banner>div')].filter(node=>node.getClientRects().length).map(node=>{const r=node.getBoundingClientRect();return{x:r.left-bounds.left-4,y:r.top-bounds.top-4,width:r.width+8,height:r.height+8};});
  // Number tokens remain legible even for an action on an adjacent edge.
  obstacles.push(...(board?.projectNumberObstacles?.()||[]));
  const placement=placeMapBubble({x,y},{width:el.offsetWidth,height:el.offsetHeight},{width:bounds.width,height:bounds.height},obstacles,feedbackPlacement);
  feedbackPlacement=placement;
  const visible=feedbackVisibility.update(!placement.blocked,performance.now());
  if(!visible&&!placement.blocked&&!feedbackRevealTimer)feedbackRevealTimer=setTimeout(()=>{feedbackRevealTimer=0;positionActionFeedback();},120);
  el.style.visibility=visible?'visible':'hidden';el.style.left=`${placement.x}px`;el.style.top=`${placement.y}px`;el.dataset.anchor=JSON.stringify({x,y});
  if(target&&leader&&visible){leader.removeAttribute('hidden');$('#feedback-line-cutouts').innerHTML=obstacles.map(r=>`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="2" fill="black"/>`).join('');leader.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);leader.querySelector('path').setAttribute('d',`M${x},${y} L${placement.edge.x},${placement.edge.y}`);}
}
function paintActionFeedback(){
  const el=$('#action-feedback'),shown=Boolean(actionFeedback&&state?.board);el.hidden=!shown;
  $('#table').classList.toggle('has-action-feedback',shown);
  if(!shown){$('#action-feedback-leader')?.setAttribute('hidden','');el.dataset.eventId='';el.dataset.eventIds='';el.dataset.kind='';el.dataset.target='';el.dataset.anchor='';$('#action-feedback-text').textContent='';return;}
  const text=$('#action-feedback-text');if(text.textContent!==actionFeedback.text)text.textContent=actionFeedback.text;
  el.dataset.eventId=String(actionFeedback.id);el.dataset.eventIds=(actionFeedback.eventIds||[actionFeedback.id]).join(',');el.dataset.kind=actionFeedback.kind;
  positionActionFeedback();
}
function showActionFeedback(event){
  clearTimeout(feedbackRevealTimer);feedbackRevealTimer=0;feedbackVisibility=new BubbleVisibility();
  actionFeedback=event;feedbackPlacement=null;
  if(event?.count>1)event.text=`${event.latestText} · +${event.count-1} 项（记录）`;
  paintActionFeedback();
  board?.setFeedback?.(actionFeedback,{reducedMotion:reducedMotion()});
  // Queued bursts are context, not a backlog of camera moves.
  if(event&&feedbackCanFollow&&autoFollow&&!followPaused&&!reducedMotion()&&!cameraBlocked()&&Date.now()-lastCameraAt>3500&&event.targets.length){
    if(board?.focusFeedback?.(event,{reducedMotion:false}))lastCameraAt=Date.now();
  }
  feedbackCanFollow=false;
}
function receiveActionFeedback(next){
  const epoch=next.presentation?.epoch||'';if(feedbackEpoch!==epoch){clearActionFeedback();feedbackEpoch=epoch;}
  const events=feedbackCursor.consume(next,{connected:status==='connected',roomKey:code});
  if(!events.length||document.hidden)return;
  feedbackCanFollow=!feedbackQueue.current&&!feedbackQueue.pending.length&&!cameraBlocked()&&autoFollow&&!followPaused&&!reducedMotion();
  for(const event of events)feedbackQueue.push(event);
}
function hover(text){$('#tile-hint').textContent=text|| (flat?'拖动平移 · 双指或加减键缩放':'拖动旋转 · 双指或滚轮缩放');if(text?.startsWith('相邻落点较近'))toast(text);}
async function select(target){
  if(target.kind==='port'){selectedPort=target.id;return openStagePanel('port');}
  if(busy||status!=='connected')return;
  const m=mode();
  if(target.kind==='tile'&&m==='robber')return send({type:'moveRobber',tile:target.id});
  if(target.kind==='edge'&&m==='road')return send({type:'buildRoad',edge:target.id});
  if(target.kind==='vertex'&&['settlement','city'].includes(m))return send({type:m==='city'?'buildCity':'buildSettlement',vertex:target.id});
}
async function send(action){
  if(busy)return;$('#stage-feedback').textContent='';busy=true;render();
  try{await connection.action(action);if(['buildRoad','buildCity','buildSettlement','buyDevelopment','playDevelopment'].includes(action.type)){inspectedBuild='';selectedBuild='';panel='';cardId='';stagePanel='';$('#stage-dialog').close();}if(action.type==='offerTrade')tradePage='offers';if(action.type==='bankTrade')toast('兑换完成');if(['discard','offerTrade','playDevelopment'].includes(action.type)){const prefix={discard:'discard',offerTrade:'give',playDevelopment:'plenty'}[action.type];for(const key of inputDrafts.keys())if(key.startsWith(prefix+'-')||action.type==='offerTrade'&&key.startsWith('want-'))inputDrafts.delete(key);for(const el of document.querySelectorAll(`[id^="${prefix}-"]${action.type==='offerTrade'?', [id^="want-"]':''}`))if(el.matches('input'))el.value='0';}return true;}catch(error){toast(error.message);if(['offerTrade','acceptTrade','cancelTrade','bankTrade'].includes(action.type))connection.sync();return false;}finally{busy=false;render();}
}
function connect(room,token,name){
  if(entryError)return toast(entryError);
  try {room=readRoom(room,backendId);}catch(error){return toast(error.message);}
  showcaseInterrupted=false;savedBoardViews.clear();toastQueue.clear();
  connection?.close();clearActionFeedback();feedbackEpoch='';followPaused=false;code=room;state=null;seenChatIds=new Set();chatBusy=false;stagePanel='';lastTaskKey='';status='connecting';
  $('#entry-dialog').close();$('#rooms-dialog').close();
  terminalMessage='';if(!DOMESTIC)storage.set('name',name);replaceViewURL(invitationURL(location.origin,code,backendId));
  connection=new Connection(code,token,name,(next)=>{const old=state;receivedAt=Date.now();if(next.room?.closed)return terminal({type:'closed',message:next.room.closeReason||'房间已关闭。'});if(!old)for(const chat of next.chat)seenChatIds.add(chat.id);if(DOMESTIC){next.chat=[];const me=next.players.find(p=>p.id===next.me);selectedNickname=NICKNAMES.find(n=>n.id===me?.nicknameId)||selectedNickname;storage.set('nicknameId',selectedNickname.id);}state=next;storage.set('last',{code,token,...(DOMESTIC?{nicknameId:selectedNickname.id}:{name})});storage.set(`token:${code}`,token);if(old?.turnNo!==next.turnNo||old?.phase!==next.phase){selectedBuild='';inspectedBuild='';if(panel!=='trade')panel='';cardId='';}if(old&&next.offer&&next.offer.from!==next.me&&old.offer?.id!==next.offer.id)toast('收到新报价 · 点交易查看');render();if(!old)restoreBoardView();receiveActionFeedback(next);},s=>{status=s;if(s!=='connected'){feedbackCursor.consume(state,{connected:false,roomKey:code});clearActionFeedback();}render();},toast,terminal);
  render();
}
async function create(practice=false){
  if(entryError)return toast(entryError);
  const name=entryNickname();if(!name)return toast('先给自己起个昵称。');
  const prefix=practice?'practice':'create',playerCount=practice?readCount(prefix):undefined,visibility=$('#create-visibility')?.value||'public',options=readOptions(prefix);
  if(practice&&!playerCount)return toast('请选择练习人数。');
  busy=true;render();const token=newId();
  try{const response=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({... (DOMESTIC?{nicknameId:name}:{name}),token,practice,playerCount,visibility:practice?'private':visibility,options})});const data=await response.json();if(!response.ok)throw new Error(data.error);$('#practice-dialog').close();connect(data.code,token,name);}catch(error){if(practice)$('#practice-feedback').textContent=error.message;else toast(error.message);}finally{busy=false;render();}
}
function join(){if(entryError)return toast(entryError);const name=entryNickname();if(!name)return toast('先给自己起个昵称。');let room;try{room=readRoom($('#join-code').value,backendId);}catch(error){return toast(error.message);}connect(room,storage.get(`token:${room}`)||newId(),name);}
const statusText=()=>({idle:'',connecting:'正在连接',connected:'已连接',reconnecting:'正在重连',failed:'连接失败',replaced:'座位已在其他页面打开'})[status];
const isHost=()=>state?.me===(state?.room?.hostId||state?.players[0]?.id);
const readCount=prefix=>Number(document.querySelector(`input[name="${prefix}-count"]:checked`)?.value);
const readOptions=prefix=>({...Object.fromEntries(variantOptions.map(v=>[v.key,Boolean($(`#${prefix}-${v.key}`)?.checked)])),...(prefix==='practice'?{playerExpansion:expansionForCount(readCount(prefix))}:{})});
renderUI(uiModel());
function updateRuleSummaries(){
  for(const prefix of ['create','room','practice']){
    const el=$(`#${prefix}-rule-summary`);if(!el)continue;
    const count=prefix==='practice'?readCount(prefix):prefix==='room'?state.players.length:0,options=readOptions(prefix),large=count>4;
    el.textContent=prefix==='create'?`3–6 人 · 自动匹配地图 · ${options.harbormaster?11:10} 分`:`${count} 人 · ${large?'大岛屿 · 配对建设':'基础版'} · ${options.harbormaster?11:10} 分${prefix==='room'&&count<3?' · 还需 '+(3-count)+' 人':''}`;
    const warning=$(`#${prefix}-compatibility`);warning.hidden=true;warning.textContent='';
    if(prefix==='room')$('#room-settings-form button[type="submit"]').disabled=busy||status!=='connected';
    if(prefix==='practice'){
      $('#practice-seats span:last-child b').textContent=String(count-1);practiceCount=count;
      $('#practice-start').disabled=busy;
    }
  }
}
function openPractice(){
  if(entryError)return toast(entryError);
  const name=entryNickname();if(!name){toast('先给自己起个昵称。');$('#nickname')?.focus();return;}
  saveDrafts();practiceOptions=readOptions('create');practiceCount=readCount('practice')||4;
  render();
  for(const [id,value]of inputDrafts){const el=document.getElementById(id);if(el?.closest('#practice-dialog')){if(['checkbox','radio'].includes(el.type))el.checked=value;else el.value=value;}}
  $('#practice-feedback').textContent='';updateRuleSummaries();$('#practice-dialog').showModal();
}
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
function formBundle(prefix){return Object.fromEntries(RESOURCES.map(r=>[r,Number($(`#${prefix}-${r}`)?.value||0)]));}
function chatMapObstacles(){
  if(!state?.board||!board)return [];
  const box=$('#board').getBoundingClientRect(),points=state.board.vertices.map(v=>board.projectFeedbackTarget({kind:'vertex',id:v.id})).filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!points.length)return [];
  const left=box.left+Math.min(...points.map(p=>p.x))-30,right=box.left+Math.max(...points.map(p=>p.x))+30,top=box.top+Math.min(...points.map(p=>p.y))-30,bottom=box.top+Math.max(...points.map(p=>p.y))+30;
  return [{left,right,top,bottom}];
}
function unreadChat(){return state?.chat.filter(c=>!seenChatIds.has(c.id)).length||0;}
function restoreDrafts(){try{const saved=JSON.parse(sessionStorage.getItem(`catan:drafts:${draftScope}`)||'[]');for(const [id,value]of saved)if(typeof id==='string'&&['string','boolean'].includes(typeof value))inputDrafts.set(id,value);}catch{}}
function saveDrafts(){const selector=draftScope==='home'?'#entry-content [data-persist],#practice-dialog [data-persist]':'#left-panel [data-persist],#stage-dialog-content [data-persist]';for(const el of document.querySelectorAll(selector))inputDrafts.set(el.id,['checkbox','radio'].includes(el.type)?el.checked:el.value);try{sessionStorage.setItem(`catan:drafts:${draftScope}`,JSON.stringify([...inputDrafts]));}catch{}}
function openStagePanel(next){if(DOMESTIC&&next==='chat')return;saveDrafts();if(stagePanel)panelScroll.set(stagePanel,$('#stage-dialog-content').scrollTop);stagePanel=next;$('#stage-feedback').textContent='';render();}
function closeStagePanel(){saveDrafts();if(stagePanel)panelScroll.set(stagePanel,$('#stage-dialog-content').scrollTop);stagePanel='';$('#stage-dialog').close();render();}
function prepareStage(task){
  if(!state){stagePanel='';lastTaskKey='';stagePhase='';return;}
  if(state.phase==='lobby'&&stagePhase&&stagePhase!=='lobby'){stagePanel='';lastTaskKey='';}
  const taskKey=task?.key||'';
  if(taskKey!==lastTaskKey){lastTaskKey=taskKey;if(task){stagePanel='decision';$('#stage-feedback').textContent='';panelScroll.set('decision',0);}else if(stagePanel==='decision')stagePanel='';}
  if(state.phase==='finished'&&stagePhase!=='finished')stagePanel='result';
  stagePhase=state.phase;
}
function stageTitle(){return !state?'':({chat:'围桌聊聊',players:`本桌玩家 · ${state.players.length} 人`,log:'岛屿记事',settings:'对局设置',hand:'你的手牌',port:'海岸港口',result:'本局结算',decision:requiredTask(state)?.title||(panel==='development'?DEV_NAMES[mine().dev.find(c=>c.id===cardId)?.type]||'发展卡':panel==='trade'?'交换资源':'交换与行动')})[stagePanel]||'';}
function uiModel(){
  const last=storage.get('last');
  return {state,domestic:DOMESTIC,backendId,code,publicCode:displayCode(code),status,statusText:statusText(),busy,isHost:isHost(),myTurn:Boolean(myTurn()),selectedBuild,inspectedBuild,panel,cardId,stagePanel,stageTitle:stageTitle(),focusedPlayer,selectedPort,tradeView,tradePage,draft:inputDrafts,flat,autoFollow,followPaused,reducedMotion:reducedMotion(),unreadChat:unreadChat(),chatBusy,task:requiredTask(state),entryError,terminalMessage,nickname:selectedNickname,name:storage.get('name')||'',invite,last:last?{code:last.code}:null,returnableRooms:roomList.rooms.filter(r=>storage.get(`token:${r.code}`)).map(r=>r.code),lobbyURL:lobbyOrigins[backendId]||null,roomList,receivedAt,reportInfo,reportContext,confirmation:confirmationCopy,homeMotion:{hidden:Boolean(state||code),disabled:flat||reducedMotion(),label:(flat||reducedMotion()?'静态展示':showcaseInterrupted?'恢复展示':'暂停展示')+'首页岛屿',glyph:flat||reducedMotion()?'island':showcaseInterrupted?'play':'pause',playing:!state&&!code&&!flat&&!reducedMotion()&&!pageAway&&!document.hidden&&!document.querySelector('dialog[open]')&&!showcaseInterrupted},practiceOptions,practiceCount};
}
function syncStage(previousPanel,previousScroll){
  const dialog=$('#stage-dialog'),scroller=$('#stage-dialog-content');
  dialog.classList.toggle('commerce-dialog',stagePanel==='decision'&&panel==='trade');
  scroller.dataset.panel=stagePanel;
  scroller.scrollTop=previousPanel===stagePanel?previousScroll:panelScroll.get(stagePanel)||0;
  if(!state||!stagePanel){dialog.close();return;}
  if(stagePanel==='chat')for(const chat of state.chat)seenChatIds.add(chat.id);
  if(!dialog.open&&!$('#room-dialog').open&&!$('#rules-dialog').open){dialog.showModal();}
}
function render(){
  const oldChat=$('#chat-messages'),chatScroll=oldChat?.scrollTop||0,followChat=!oldChat||oldChat.scrollHeight-oldChat.clientHeight-chatScroll<32;
  const detailsState=new Map([...document.querySelectorAll('details[id]')].map(el=>[el.id,el.open]));
  const nextScope=state?.me&&code?`${backendId}:${code}:${state.me}`:'home';
  if(nextScope!==draftScope){saveDrafts();inputDrafts.clear();draftScope=nextScope;restoreDrafts();$('#stage-dialog-content').dataset.panel='';}else saveDrafts();
  const activeElement=document.activeElement,active=activeElement?.id,start=activeElement?.selectionStart;
  if(state?.board)normalizeTradeDraft(state,inputDrafts);
  const task=requiredTask(state);
  const previousPanel=$('#stage-dialog-content').dataset.panel,previousScroll=$('#stage-dialog-content').scrollTop;
  prepareStage(task);
  document.body.classList.toggle('at-table',Boolean(state));
  document.body.classList.toggle('domestic-site',DOMESTIC);
  document.body.classList.toggle('at-home',!state);
  document.body.classList.toggle('reduced-action-motion',reducedMotion());
  document.body.dataset.gameTheme='catan';
  renderUI(uiModel());
  if(state){$('#entry-dialog').close();$('#rooms-dialog').close();}
  syncStage(previousPanel,previousScroll);
  for(const [id,value] of inputDrafts){const el=document.getElementById(id);if(el&&el!==activeElement){if(['checkbox','radio'].includes(el.type))el.checked=value;else el.value=value;}}
  updateRuleSummaries();
  for(const [id,open] of detailsState){const el=document.getElementById(id);if(el)el.open=open;}
  if(active){const el=document.getElementById(active);if(el&&el!==activeElement){el.focus({preventScroll:true});if(start!=null && ['text','search'].includes(el.type))try{el.setSelectionRange(start,start);}catch{}}}
  // Measure the new HUD before the first island fit, including reduced-motion
  // sessions whose later notice padding must preserve their settled camera.
  syncViewport();board?.set(sceneState(),mode());
  if(cameraBlocked()){feedbackCanFollow=false;board?.cancelFocus?.();}
  feedbackQueue.pause(Boolean(document.querySelector('dialog[open]')));updateAmbient();paintActionFeedback();
  for(const el of document.querySelectorAll('.activity-log'))el.scrollTop=el.scrollHeight;
  if($('#chat-messages'))$('#chat-messages').scrollTop=followChat?$('#chat-messages').scrollHeight:chatScroll;
  bindForms();
  document.querySelector('[data-action="confirmRoomDialog"]').disabled=busy;
  syncViewport();
  chatPreview?.update(state,{connected:status==='connected',room:code,open:stagePanel==='chat'||Boolean(document.querySelector('dialog[open]'))});
}
function updateAmbient(){
  const home=!state&&!code;
  const paused=pageAway||document.hidden||Boolean(document.querySelector('dialog[open]'))||showcaseInterrupted;
  board?.setAmbient?.(home&&!paused,{reducedMotion:reducedMotion(),sceneEnabled:home&&!pageAway&&!document.hidden&&!document.querySelector('dialog[open]')});
  renderUI(uiModel());
}

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
  if(!DOMESTIC&&$('#chat-form'))$('#chat-form').onsubmit=sendChat;
  if($('#development-form'))$('#development-form').onsubmit=e=>{e.preventDefault();send({type:'playDevelopment',cardId,cards:formBundle('plenty'),resource:$('#monopoly-resource')?.value});};
  bindQuantityForms();
}
document.addEventListener('click',async e=>{
  const nav=e.target.closest('a[data-lobby-link],a[data-home-link]');if(nav&&code){e.preventDefault();openLeave(nav.hasAttribute('data-lobby-link')?'lobby':'home');return;}
  const b=e.target.closest('button');
  if(inspectedBuild&&!e.target.closest('.build-cost,[data-build]')&&!b){inspectedBuild='';render();}
  if(!b||b.disabled)return;
  if(b.dataset.player){focusedPlayer=b.dataset.player;return openStagePanel('players');}
  if(b.dataset.reportMessage){const message=state?.chat.find(message=>message.id===b.dataset.reportMessage);return openReport(message);}
  if(b.dataset.build){inspectedBuild=b.dataset.build;selectedBuild=inspectedBuild!=='development'&&buildAvailability(state,inspectedBuild).can?inspectedBuild:'';panel='';return render();}
  if(b.dataset.tradeView){tradeView=b.dataset.tradeView;return render();}
  if(b.dataset.tradePage){tradePage=b.dataset.tradePage;return render();}
  if(b.dataset.bankSide){inputDrafts.set('bank-'+b.dataset.bankSide,b.dataset.resource);saveDrafts();return render();}
  if(b.dataset.side){const side=b.dataset.side,r=b.dataset.resource,key=side+'-'+r,other=(side==='give'?'want':'give')+'-'+r,max=side==='give'?mine().hand[r]:state.profile?.resourceCount||19;
    if(Number(b.dataset.delta)>0&&Number(inputDrafts.get(other)))return;
    inputDrafts.set(key,String(Math.max(0,Math.min(max,(Number(inputDrafts.get(key))||0)+Number(b.dataset.delta)))));saveDrafts();return render();}
  if(b.dataset.listRoom){const room=b.dataset.listRoom,name=entryNickname()||(!DOMESTIC&&storage.get('name'));if(!name){$('#rooms-dialog').close();$('#entry-dialog').showModal();$('#join-code').value=displayCode(room);saveDrafts();$('#nickname')?.focus({preventScroll:true});toast('填写昵称后即可加入已选房间。');return;}return connect(room,storage.get(`token:${room}`)||newId(),name);}
  if(b.dataset.kick)return openConfirmation({type:'kick',playerId:b.dataset.kick},'移出玩家',`将 ${state.players.find(p=>p.id===b.dataset.kick)?.name||'该玩家'} 移出等待房间？对方席位及原身份将失效。`,'确认移出');
  if(b.dataset.transfer)return openConfirmation({type:'transferHost',playerId:b.dataset.transfer},'转交房主',`将房主权限交给 ${state.players.find(p=>p.id===b.dataset.transfer)?.name||'该玩家'}？你的座位保留，解散与房间设置权限会立即转移。`,'确认转交');
  if(b.dataset.removeBot)return send({type:'removeBot',playerId:b.dataset.removeBot});
  if(b.dataset.victim)return send({type:'steal',victim:b.dataset.victim});
  if(b.dataset.card){cardId=b.dataset.card;panel='development';return openStagePanel('decision');}
  const action=b.dataset.action;
  if(action==='newNickname'&&DOMESTIC&&!code){selectedNickname=randomNickname(selectedNickname.id);storage.set('nicknameId',selectedNickname.id);return render();}
  if(action==='homeMotion'){
    if(state||code||flat||reducedMotion())return;
    showcaseInterrupted=!showcaseInterrupted;
    if(!showcaseInterrupted)board.resumeShowcase?.();
    updateAmbient();return;
  }
  if(action==='openEntry'){saveDrafts();$('#entry-dialog').showModal();return;}
  if(action==='closeEntry'){$('#entry-dialog').close();return;}
  if(action==='openRooms'){$('#rooms-dialog').showModal();return;}
  if(action==='closeRooms'){$('#rooms-dialog').close();return;}
  if(action==='homePractice'){
    if(!entryNickname()){$('#entry-dialog').showModal();$('#nickname').focus({preventScroll:true});return toast('填写昵称后，点「人机练习」选择人数。');}
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
  if(action==='transferMenu')return openConfirmation({type:'chooseTransfer'},'转交房主','转交后你的座位保留，房主权限与房间离线保留期归新房主管理。','确认转交');
  if(action==='pauseGame')return openConfirmation({type:'pause'},'暂停对局',state.room?.practice?'暂停后电脑和对局操作停止，原局面保留。练习房离线后仍保留 10 分钟。':'暂停后电脑和对局操作停止。本次暂停首次离线起固定保留最多 4 小时，短暂重连不延长期限。','确认暂停');
  if(action==='resumeGame')return send({type:'resume'});
  if(action==='dissolve')return openConfirmation({type:'close'},'解散房间','解散会结束所有成员的房间，旧邀请、存档与重连都不能恢复。此操作与暂离不同。','确认解散');
  if(action==='cancelRoomDialog'){confirmation=null;$('#room-dialog').close();return render();}
  if(action==='confirmRoomDialog')return confirmRoomDialog();
  if(['start','addBot','roll','endTurn','cancelTrade','rematch'].includes(action))return send({type:action});
  if(action==='acceptTrade')return send({type:'acceptTrade',offerId:b.dataset.offerId});
  if(action==='publishTrade')return send({type:'offerTrade',give:Object.fromEntries(RESOURCES.map(r=>[r,Math.min(mine().hand[r],Number(inputDrafts.get('give-'+r))||0)])),want:Object.fromEntries(RESOURCES.map(r=>[r,Number(inputDrafts.get('want-'+r))||0]))});
  if(action==='exchangeBank')return send({type:'bankTrade',give:inputDrafts.get('bank-give')||'wood',want:inputDrafts.get('bank-want')||'ore'});
  if(action==='buyDevelopment')return send({type:'buyDevelopment'});
  if(action==='closeCost'){inspectedBuild='';selectedBuild='';return render();}
  if(action==='rules'){saveDrafts();return $('#rules-dialog').showModal();}if(action==='closeRules'){ $('#rules-dialog').close();return render();}
  if(action==='reset'){if(!state&&!code){board.reset({defaultOrientation:true});return;}pauseFollowing();return board.reset();}
  if(action==='zoomIn'||action==='zoomOut')return board.zoomBy(action==='zoomIn'?1.25:.8);
  if(action==='practice')return openPractice();
  if(action==='closePractice')return $('#practice-dialog').close();
  if(action==='trade'){panel='trade';selectedBuild='';inspectedBuild='';if(state.offer){tradePage='offers';tradeView='players';}return openStagePanel('decision');}
  if(action==='closePanel')return closeStagePanel();
  if(action==='resume'){const last=storage.get('last');if(last)connect(last.code,last.token,DOMESTIC?(last.nicknameId||selectedNickname.id):last.name);return;}
  if(action==='home')return openLeave('home');
  if(action==='invite'){const link=invitationURL(location.origin,code,backendId);try{await navigator.clipboard.writeText(link);toast('邀请链接已复制，发给朋友即可加入。');}catch{toast(`房间码：${displayCode(code)}。将当前页面地址发给朋友即可。`);}return;}
  if(b.id==='flat-toggle'||action==='toggleFlat'){saveBoardView();flat=!flat;makeBoard();render();saveBoardView();}
});
function forgetIdentity(room){storage.set(`token:${room}`,null);if(storage.get('last')?.code===room)storage.set('last',null);}
function terminal(message){const current=code;forgetIdentity(current);terminalMessage=message.message||(message.type==='removed'?'你已被移出房间，原身份已失效。':'房间已关闭，旧链接不能恢复。');connection?.close();clearActionFeedback();toastQueue.clear();connection=null;state=null;code='';status='idle';invite='';replaceViewURL('/');$('#room-dialog').close();confirmation=null;render();refreshRooms();}
function exitView(destination){saveBoardView();connection?.close();clearActionFeedback();toastQueue.clear();connection=null;state=null;code='';status='idle';selectedBuild='';panel='';invite='';replaceViewURL('/');if(destination==='lobby'){const target=gameLobbyURL(backendId);if(target){location.assign(target);return;}}render();refreshRooms();}
function openConfirmation(task,title,description,confirmText='确认'){confirmation=task;confirmationCopy={title,description,confirmText,chooseTransfer:task.type==='chooseTransfer'};render();$('#room-dialog').showModal();}
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
  }else if(!state){
    const rect=selector=>{const el=$(selector);return el?.getClientRects().length&&getComputedStyle(el).display!=='none'?el.getBoundingClientRect():null;};
    const safeCSS=getComputedStyle($('#home-safe-area')),safe=Object.fromEntries(['top','right','bottom','left'].map(side=>[side,parseFloat(safeCSS.getPropertyValue(`padding-${side}`))||0]));
    const padding=homePadding(innerWidth,innerHeight,{header:rect('.topbar'),brand:rect('.topbar .brand'),nav:rect('.topbar nav'),welcome:rect('#home-welcome'),server:rect('.entry-server'),dock:rect('#home-dock'),controls:rect('.board-controls'),safe,sideControls:matchMedia('(orientation:landscape) and (max-height:600px)').matches});
    $('#board').dataset.homePadding=JSON.stringify(padding);board?.setViewportPadding?.(padding);
  }
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
document.addEventListener('visibilitychange',()=>{toastQueue.pause(document.hidden);if(document.hidden){clearActionFeedback();board?.cancelFocus?.();}updateAmbient();});
$('#rules-dialog').addEventListener('close',()=>{if(stagePanel)render();else paintActionFeedback();});
$('#room-dialog').addEventListener('close',()=>{if(stagePanel)render();else paintActionFeedback();});
$('#stage-dialog').addEventListener('cancel',e=>{e.preventDefault();closeStagePanel();});
replaceViewURL=installDialogDismissal({beforeClose:saveDrafts,onStageClose:closeStagePanel,onChange:()=>{updateAmbient();feedbackQueue.pause(Boolean(document.querySelector('dialog[open]')));paintActionFeedback();},canDismiss:dialog=>dialog.id!=='stage-dialog'||stagePanel!=='decision'||!requiredTask(state)||state.room?.paused}).replaceURL;
restoreDrafts();makeBoard();render();syncViewport();
document.addEventListener('input',event=>{if(event.target.matches('[data-persist]'))saveDrafts();});
document.addEventListener('change',event=>{if(event.target.matches('[data-persist]'))saveDrafts();});
const hudObserver=new ResizeObserver(syncViewport);for(const selector of ['#stage-tools','#turn-banner','#player-orbit','#home-dock','#hand','#play-dock','#home-welcome','.topbar','.entry-server','.board-controls'])hudObserver.observe($(selector));
document.fonts.ready.then(syncViewport);
window.addEventListener('pagehide',()=>{pageAway=true;saveDrafts();saveBoardView();clearActionFeedback();toastQueue.clear();clearTimeout(viewSaveTimer);viewSaveTimer=0;updateAmbient();board?.dispose();});
window.addEventListener('pageshow',event=>{pageAway=false;if(event.persisted){makeBoard();render();syncViewport();}});
if(!entryError)refreshRooms();
const last=storage.get('last');if(!entryError&&invite&&last?.code===invite)connect(last.code,last.token,DOMESTIC?(last.nicknameId||selectedNickname.id):last.name);
window.addEventListener('online',()=>{if(connection&&!connection.stopped&&connection.ws.readyState>1){clearTimeout(connection.reconnectTimer);connection.connect();}});
