import { UserError } from './errors.js';
export const DAY=86400000;
export const CHAT_DAYS=7;
export const CHAT_LIMIT=100;
// Confirmed by the operator for Catan; an explicit empty override disables mail.
export const DEFAULT_CONTACT='qiutian0808@163.com';
export function securityConfig(env={}) {
  const configuredContact=env.REPORT_CONTACT??DEFAULT_CONTACT;
  const contact=typeof configuredContact==='string' && /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(configuredContact) ? configuredContact : '';
  const days=Number(env.MODERATION_RETENTION_DAYS??90);
  const retentionDays=Number.isInteger(days) && days>=1 && days<=3650 ? days : null;
  const secret=env.SECURITY_ADMIN_TOKEN;
  const adminReady=typeof secret==='string' && /^[A-Za-z0-9_-]{32,256}$/.test(secret) && retentionDays!==null;
  return {contact,retentionDays,adminReady,chatDays:CHAT_DAYS,chatLimit:CHAT_LIMIT};
}
export async function adminAuthorized(authorization,env) {
  if(!securityConfig(env).adminReady || typeof authorization!=='string' || !authorization.startsWith('Bearer ') || authorization.length>300)return false;
  const digest=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const [a,b]=await Promise.all([digest(env.SECURITY_ADMIN_TOKEN),digest(authorization.slice(7))]);
  let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
}
export const emptyModeration=()=>({version:1,hiddenChat:[],names:{},restricted:[],closed:false,audit:[]});
export function pruneModeration(state,now=Date.now()) {
  state.audit=state.audit.filter(event=>event.held || event.expiresAt>now);
  return state;
}
export function closedModeration(state) {
  if(state.closed && !state.hiddenChat.length && !Object.keys(state.names).length && !state.restricted.length)return state;
  return {...state,closed:true,hiddenChat:[],names:{},restricted:[]};
}
export function applyModeration(room,state) {
  room.moderation=state;
  if(!state || room.record.closed)return;
  if(state.closed){room.close('站长已关闭房间。');return;}
  const r=room.record,g=r.game;
  r.chat=r.chat.filter(message=>!state.hiddenChat.includes(message.id));
  for(const [id,name] of Object.entries(state.names)) {
    const p=g.players.find(player=>player.id===id);
    const oldNames=new Set([p?.name,...r.chat.filter(message=>message.playerId===id).map(message=>message.name)].filter(value=>value && value!==name));
    if(p)p.name=name;
    for(const message of r.chat){if(message.playerId===id)message.name=name;for(const old of oldNames)message.text=message.text.split(old).join(name);}
    // Legacy public text cannot reliably identify a nickname's author.
    if(oldNames.size){g.log=[];if(g.presentation)g.presentation.events=[];}
  }
}
export function inspectRoom(room,state,now=Date.now()) {
  return {closed:!!room.record.closed,players:room.record.game?.players.map(({id,name,bot})=>({id,name,bot}))||[],
    chat:room.chatHistory(now),moderation:{hiddenChat:state.hiddenChat,names:state.names,restricted:state.restricted,closed:state.closed},audit:state.audit};
}
// This ledger is stored independently of the game record. Never copy requests,
// authentication material, exceptions, hands or the random stream into it.
export function disposition(room,source,input,config,now=Date.now()) {
  if(!config.adminReady)throw new UserError('站长权限或处置记录留存期限尚未配置。');
  if(!input || typeof input!=='object' || Array.isArray(input))throw new UserError('处置格式无效。');
  const {action,id,reason,messageId,memberId,eventId,held}=input;
  const keys={inspect:['action','id'], 'hide-chat':['action','id','reason','messageId'], 'reset-name':['action','id','reason','memberId'],
    'restrict-member':['action','id','reason','memberId'],'restore-member':['action','id','reason','memberId'],'close-room':['action','id','reason'],
    hold:['action','id','reason','eventId','held']}[action];
  if(!keys || Object.keys(input).some(key=>!keys.includes(key)) || typeof id!=='string' || !/^[\w-]{1,80}$/.test(id))throw new UserError('处置格式或操作编号无效。');
  const state=pruneModeration(structuredClone(source),now);
  if(state.audit.some(event=>event.id===id))return {state,result:{ok:true,duplicate:true}};
  if(action!=='inspect' && (typeof reason!=='string' || !reason.trim() || reason.length>200 || /[\p{Cc}\p{Cf}]/u.test(reason)))throw new UserError('请填写 1–200 字处置原因，不要填写凭据。');
  if(state.audit.length>=1000)throw new UserError('处置记录容量已满，请先按留存要求归档，不能覆盖未到期记录。');
  const event={id,at:now,expiresAt:now+config.retentionDays*DAY,actor:'stationmaster',action,...(action==='inspect'?{}:{reason:reason.trim()})};
  if(action==='hide-chat') {
    const message=room.record.chat?.find(message=>message.id===messageId);
    if(!message)throw new UserError('消息不存在或已不在历史中。');
    if(!state.hiddenChat.includes(messageId))state.hiddenChat.push(messageId);
    event.target=messageId;event.evidence={name:message.name,text:message.text};
  } else if(['reset-name','restrict-member','restore-member'].includes(action)) {
    const member=room.record.game?.players.find(player=>player.id===memberId && !player.bot);
    if(!member)throw new UserError('真人成员不存在。');
    event.target=memberId;
    if(action==='reset-name'){state.names[memberId]='成员'+memberId.slice(0,8);event.evidence={name:member.name};}
    if(action==='restrict-member' && !state.restricted.includes(memberId))state.restricted.push(memberId);
    if(action==='restore-member')state.restricted=state.restricted.filter(id=>id!==memberId);
  } else if(action==='close-room'){state.closed=true;state.hiddenChat=[];state.names={};state.restricted=[];}
  else if(action==='hold') {
    const target=state.audit.find(event=>event.id===eventId && event.action!=='hold');
    if(!target || typeof held!=='boolean')throw new UserError('保全目标或状态无效。');
    target.held=held;
    for(const prior of state.audit)if(prior.action==='hold' && prior.target===eventId)prior.held=held;
    event.target=eventId;event.held=held;
  }
  state.audit.push(event);
  return {state,result:{ok:true}};
}
