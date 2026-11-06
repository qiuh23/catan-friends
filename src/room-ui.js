import { lobbyOrigins } from './invitation.js';

export const variantOptions = [
  { key:'friendlyRobber', name:'友善强盗', glyph:'shield', summary:'保护低分玩家', description:'公开分不超过 2 分的玩家受强盗保护；掷出 7 仍须按基础规则弃牌。' },
  { key:'harbormaster', name:'卡坦港口', glyph:'anchor', summary:'争夺港口奖励 · 11 分', description:'港口村庄计 1 港口分、城市计 2 分；港口奖励值 2 胜利分，目标改为 11 分。' },
];
export function expansionForCount(count) {
  if(!Number.isInteger(count)||count<3||count>6)throw new Error('请选择 3、4、5 或 6 人。');
  return count>4?'five-six-2025':'base';
}
export function rulesLabel(options={}) {
  const names=variantOptions.filter(v=>options[v.key]).map(v=>v.name);
  const base=options.playerExpansion==='five-six-2025'?'5–6 人扩充（2025）':'经典基础版';
  return names.length?`${base} + ${names.join(' + ')}`:base;
}
export function roomAvailability(room,canReturn=false) {
  if(canReturn)return {label:'原身份返回',disabled:false};
  if(room.closed)return {label:'已关闭',disabled:true};
  if(room.phase==='finished')return {label:'已结束',disabled:true};
  if(room.status==='paused')return {label:'已暂停',disabled:true};
  if(room.phase!=='lobby')return {label:'进行中',disabled:true};
  if(room.playerCount>=room.maxPlayers)return {label:'已满',disabled:true};
  return {label:'加入房间',disabled:false};
}
export function remainingTime(expiresAt,serverNow,receivedAt,now=Date.now()) {
  if(!Number.isFinite(expiresAt))return null;
  const millis=Math.max(0,expiresAt-((Number.isFinite(serverNow)?serverNow:receivedAt)+Math.max(0,now-receivedAt)));
  const seconds=Math.ceil(millis/1000);
  return seconds>=3600?`${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds%3600/60)} 分`: `${Math.floor(seconds/60)} 分 ${String(seconds%60).padStart(2,'0')} 秒`;
}
// Destinations are fixed, server-specific and never copy room queries or tokens.
export function gameLobbyURL(backendId) {return lobbyOrigins[backendId]||null;}
export function mergeRoomPages(current,next) {return [...new Map([...current,...next].map(room=>[room.code,room])).values()];}
export function leaveDescription({lobby,host,practice=false,paused=false,target='首页'}) {
  if(lobby&&host)return `你是房主。返回${target}会暂离房间并保留房主身份，房间从你的最后一个连接离线起保留 30 分钟。若要退出席位，请先转交房主；解散会结束所有人的房间。`;
  if(lobby)return `返回${target}会退出座位并释放席位。以后可重新加入，原身份将失效。`;
  return `返回${target}会暂离，保留你的身份和牌局。${practice?'练习房离线后保留 10 分钟。':paused?'本次暂停首次离线起固定保留最多 4 小时，重连不延长截止时间。':host?'房主最后一个连接离线后保留 30 分钟。':'房间按房主的离线期限保留。'}解散是单独的房主操作。`;
}
