import { siteEdition, assignNickname, NICKNAMES, rejectCommunication, validateNicknameInput } from './site-policy.js';
import { createGame, addPlayer, act, viewFor, botAction, afford, total, ruleProfile, optionsForPlayers } from './game.js';
import { createRandomStream, validRandomStream } from './random.js';
import { UserError } from './errors.js';
import { CHAT_DAYS, CHAT_LIMIT, DAY } from './moderation.js';
export const ROOM_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
export const HOST_RETENTION = 30 * 60 * 1000;
export const PAUSE_RETENTION = 4 * 60 * 60 * 1000;
export const PRACTICE_RETENTION = 10 * 60 * 1000;
// Compatibility export only: activity age no longer determines room lifetime.
export const ROOM_TTL = 48 * 60 * 60 * 1000;
export function roomCode() {
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>alphabet[n%alphabet.length]).join('');
}
export async function fingerprint(token) {
  if (typeof token!=='string' || !/^[a-f\d-]{36,80}$/i.test(token)) throw new UserError('登录凭证无效，请重新加入。');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
export class Room {
  constructor(record, now=Date.now(), edition='global') {
    this.siteEdition=siteEdition(edition);
    if(record?.siteEdition && record.siteEdition!==this.siteEdition)throw new Error('Saved room belongs to another site edition.');
    this.record=record || {version:2,game:createGame(),identities:{},revision:0,receipts:[],chat:[],updatedAt:now,createdAt:now,visibility:'public',practice:false};
    const r=this.record;if(r.closed)return;
    if(r.version>3)throw new Error('Unsupported room schema');
    r.version=3;r.hostId ||= r.game.players[0]?.id || null;r.game.hostId=r.hostId;
    // Only missing legacy streams migrate. Corrupt/unknown streams fail closed.
    if(!Object.hasOwn(r,'random'))r.random=Object.hasOwn(r.game,'random')?r.game.random:createRandomStream();
    delete r.game.random;
    if(!validRandomStream(r.random))throw new Error('Invalid room random stream');
    r.chat ||= [];r.chatReceipts ||= [];r.chatRates ||= {};r.chatSequence ??= r.chat.length;
    for(let i=0;i<r.chat.length;i++){r.chat[i].sentAt ??= r.updatedAt ?? now;r.chat[i].seq ??= i+1;}
    r.chat=this.chatHistory(now);
    r.visibility ||= 'private';r.practice=!!r.practice;r.paused=!!r.paused;
    r.createdAt ??= r.updatedAt ?? now;r.hostSeenAt ??= r.updatedAt ?? now;
    r.hostConnected=!!r.hostConnected;r.hostOfflineAt ??= r.hostConnected ? null : (r.updatedAt ?? now);
    r.pauseOfflineAt ??= null;r.revoked ||= [];
    r.siteEdition=this.siteEdition;this.enforceSitePolicy();
  }
  enforceSitePolicy() {
    const r=this.record;if(this.siteEdition!=='cn'||r.closed)return;
    const players=[];let migrated=false;
    for(const p of r.game.players){
      const known=NICKNAMES.find(n=>n.id===p.nicknameId);
      if(!known){Object.assign(p,assignNickname(players));migrated=true;}
      else if(p.name!==known.name){p.name=known.name;migrated=true;}
      players.push(p);
    }
    // Keep unprovable legacy text private; gameplay/identity/random data stay intact.
    if(!r.cnTextMigration || migrated){
      r.legacyPublicText ||= {log:structuredClone(r.game.log||[]),events:structuredClone(r.game.presentation?.events||[])};
      r.game.log=[];if(r.game.presentation)r.game.presentation.events=[];r.cnTextMigration=1;
    }
    r.chat=[];r.chatReceipts=[];r.chatRates={};
  }
  assertOpen(now=Date.now()) {
    this.expire(now);
    if(this.record.closed)throw Object.assign(new UserError(this.record.closeReason || '房间已关闭，请创建新房间。'),{code:'ROOM_CLOSED'});
  }
  deadline() {
    const r=this.record;if(r.closed)return null;
    if(r.practice)return r.hostConnected ? null : r.hostOfflineAt+PRACTICE_RETENTION;
    if(r.paused && r.pauseOfflineAt!==null)return r.pauseOfflineAt+PAUSE_RETENTION;
    return r.hostConnected ? null : r.hostOfflineAt+HOST_RETENTION;
  }
  presence(online=[],now=Date.now(),recover=false) {
    this.online=[...online];
    // A late reconnect cannot clear the old offline deadline before it is checked.
    this.expire(now);const r=this.record;if(r.closed)return;const connected=online.includes(r.hostId);
    r.chat=this.chatHistory(now);
    if(connected) {r.hostConnected=true;r.hostSeenAt=now;r.hostOfflineAt=null;}
    else {
      if(r.hostConnected || r.hostOfflineAt===null)r.hostOfflineAt=recover ? Math.min(now,r.hostSeenAt ?? r.updatedAt ?? now) : now;
      r.hostConnected=false;
      if(r.paused && !r.practice && r.pauseOfflineAt===null)r.pauseOfflineAt=r.hostOfflineAt;
    }
    this.expire(now);
  }
  expire(now=Date.now()) {
    const until=this.deadline();
    if(until!==null && now>=until){this.close('房间保留时间已到，已关闭并清理对局数据。',now);return true;}
    return false;
  }
  close(reason='房主已解散房间。',now=Date.now()) {
    const r=this.record;if(r.closed)return;
    // Permanent tiny tombstones prevent old invitations or tokens resurrecting rooms.
    this.record={version:3,closed:true,closedAt:now,closeReason:reason,revision:r.revision+1,createdAt:r.createdAt};
  }
  join(hash,name,now=Date.now(),nicknameId) {
    this.assertOpen(now);const r=this.record;
    if(r.revoked.includes(hash) || this.moderation?.restricted.includes(r.identities[hash]))throw Object.assign(new UserError('原身份已失效：你已离开座位、被移出或受站长限制。'),{code:'IDENTITY_REVOKED'});
    let id=r.identities[hash];
    if(!id){
      if(r.practice && r.game.players.length)throw new UserError('个人练习房不接受其他玩家。');
      if(this.siteEdition==='cn')validateNicknameInput(name,nicknameId);
      id=crypto.randomUUID();const nickname=this.siteEdition==='cn'?assignNickname(r.game.players,nicknameId):null;
      addPlayer(r.game,id,nickname?.name||name);if(nickname)Object.assign(r.game.players.at(-1),nickname);r.identities[hash]=id;
      if(!r.hostId){r.hostId=id;r.game.hostId=id;}
      r.revision++;r.updatedAt=now;
    }
    return id;
  }
  revoke(id) {
    const r=this.record;
    for(const [hash,player] of Object.entries(r.identities))if(player===id){r.revoked.push(hash);delete r.identities[hash];}
    r.game.players=r.game.players.filter(p=>p.id!==id);r.game.players.forEach(p=>{p.ready=p.bot;});
    delete r.chatRates[id];
  }
  handle(id,message,now=Date.now()) {
    this.assertOpen(now);
    const before=this.record;this.record=structuredClone(before);
    try{return this.handleCommand(id,message,now);}catch(error){this.record=before;throw error;}
  }
  gameAction(game,id,action) {
    // Keep the persisted stream at the private room boundary. Even legacy
    // clients/older game projections which spread game fields cannot see it.
    const next=act({...game,random:this.record.random},id,action);
    this.record.random=next.random;delete next.random;return next;
  }
  handleCommand(id,message,now) {
    this.assertOpen(now);rejectCommunication(this.siteEdition,message);
    if(this.siteEdition==='cn' && (/rename|nickname|setName/i.test(message?.action?.type||'') || Object.hasOwn(message?.action||{},'name')))throw new UserError('当前站点仅接受本游戏固定昵称编号。');
    const r=this.record;
    if(!message || typeof message.id!=='string' || !/^[\w-]{1,80}$/.test(message.id))throw new UserError('操作编号无效。');
    if(!r.game.players.some(p=>p.id===id) || this.moderation?.restricted.includes(id))throw Object.assign(new UserError('原身份已失效，你不在这个房间中或已受站长限制。'),{code:'IDENTITY_REVOKED'});
    if([...r.receipts,...r.chatReceipts].some(v=>v.actor===id && v.id===message.id))return {type:'ack',id:message.id,ok:true};
    const a=message.action,g=r.game;
    if(!a || typeof a.type!=='string')throw new UserError('操作无效。');
    if(a.type==='chat') {
      if(typeof a.text!=='string' || !a.text.trim() || a.text.length>200 || /[\p{Cc}\p{Cf}]/u.test(a.text))throw new UserError('消息需要 1–200 个字符，且不能包含控制字符。');
      const old=r.chatRates[id]||{tokens:5,at:now},tokens=Math.min(5,old.tokens+Math.max(0,now-old.at)/2000);
      if(tokens<1)throw Object.assign(new UserError('聊天发送过快，请稍后再试。'),{code:'CHAT_LIMITED'});
      r.chatRates[id]={tokens:tokens-1,at:now};
      r.chat=this.chatHistory(now);
      r.chat.push({id:crypto.randomUUID(),seq:++r.chatSequence,playerId:id,name:g.players.find(p=>p.id===id).name,text:a.text.trim(),sentAt:now});r.chat=r.chat.slice(-CHAT_LIMIT);
      r.chatReceipts.push({actor:id,id:message.id});r.chatReceipts=r.chatReceipts.slice(-512);
      // Chat has its own sequence/receipts and never invalidates game commands.
      return {type:'ack',id:message.id,ok:true};
    }
    if(message.revision!==r.revision)throw new UserError('棋盘已更新，请按最新状态重试。');
    const host=r.hostId===id;
    if(a.type==='start' && this.online && g.players.some(p=>!p.bot && !this.online.includes(p.id)))throw new UserError('请等待所有真人玩家在线并准备后再开局。');
    if(['addBot','removeBot','rematch','kick','transferHost','configure','setOptions','close','pause','resume'].includes(a.type) && !host)throw new UserError('只有房主可以执行此操作。');
    if(r.paused && !['chat','leave','close','resume','transferHost'].includes(a.type))throw new UserError('房主已暂停对局，请等待恢复。');
    if(a.type==='close'){this.close(undefined,now);return {type:'ack',id:message.id,ok:true};}
    if(a.type==='pause'){
      if(['lobby','finished'].includes(g.phase))throw new UserError('只有进行中的对局可以暂停。');
      r.paused=true;r.pauseOfflineAt=null;
    } else if(a.type==='resume'){r.paused=false;r.pauseOfflineAt=null;
    } else if(a.type==='transferHost'){
      const p=g.players.find(p=>p.id===a.playerId && !p.bot && p.id!==id);if(!p)throw new UserError('请选择另一位真人玩家。');
      r.hostId=p.id;g.hostId=p.id;r.hostConnected=false;r.hostOfflineAt=now;r.hostSeenAt=now;
    } else if(a.type==='leave'){
      if(g.phase==='lobby'){if(host)throw new UserError('请先转交房主，或确认解散房间。');this.revoke(id);}
    } else if(a.type==='kick' || a.type==='removeBot'){
      if(g.phase!=='lobby')throw new UserError('只能在开局前移除玩家。');
      const p=g.players.find(p=>p.id===a.playerId);if(!p || p.id===r.hostId || (a.type==='removeBot' && !p.bot))throw new UserError('不能移除此玩家。');this.revoke(p.id);
    } else if(a.type==='configure' || a.type==='setOptions'){
      if(g.phase!=='lobby')throw new UserError('只能在开局前修改房间设置。');
      if(a.visibility!==undefined && !['public','private'].includes(a.visibility))throw new UserError('房间可见性无效。');
      r.game=a.options===undefined ? g : this.gameAction(g,id,{type:'setOptions',options:a.options});
      if(a.visibility!==undefined)r.visibility=a.visibility;r.game.players.forEach(p=>{p.ready=p.bot;});
    } else if(a.type==='addBot'){
      const nickname=this.siteEdition==='cn'?assignNickname(g.players):null;
      addPlayer(g,crypto.randomUUID(),nickname?.name||['松林','麦田','远山'][g.players.filter(p=>p.bot).length]||'海风',true);if(nickname)Object.assign(g.players.at(-1),nickname);
    } else if(a.type==='rematch'){
      if(g.phase!=='finished')throw new UserError('本局结束后才能重新开局。');
      const next=createGame(g.options);for(const p of g.players){addPlayer(next,p.id,p.name,p.bot);if(p.nicknameId)Object.assign(next.players.at(-1),{nicknameId:p.nicknameId,...(p.nicknameBadge?{nicknameBadge:p.nicknameBadge}:{})});}next.hostId=r.hostId;r.random=next.random;delete next.random;r.game=next;
    } else r.game=this.gameAction(g,id,a);
    r.revision++;r.updatedAt=now;r.receipts.push({actor:id,id:message.id});r.receipts=r.receipts.slice(-256);
    return {type:'ack',id:message.id,ok:true};
  }
  chatHistory(now=Date.now()) {
    if(this.siteEdition==='cn')return [];
    return (this.record.chat||[]).filter(message=>Number.isFinite(message.sentAt) && message.sentAt>now-CHAT_DAYS*DAY).slice(-CHAT_LIMIT)
      .map(({id,seq,playerId,name,text,sentAt})=>({id,seq,playerId,name,text,sentAt}));
  }
  nextBot() {
    const r=this.record;if(r.closed || r.paused)return null;const g=r.game;
    if(['lobby','finished'].includes(g.phase))return null;
    if(g.phase==='action' && g.offer && total(g.offer.give)>=total(g.offer.want) && afford(g.players.find(p=>p.id===g.offer.from).hand,g.offer.give)){
      const buyer=g.players.find(p=>p.bot && p.id!==g.offer.from && afford(p.hand,g.offer.want));if(buyer)return {actor:buyer.id,action:{type:'acceptTrade',offerId:g.offer.id}};
    }
    const p=g.phase==='discard' ? g.players.find(p=>p.bot && g.discards[p.id]) : g.players[g.turn];if(!p?.bot)return null;
    const action=botAction(g,p.id);return action ? {actor:p.id,action} : null;
  }
  tick(now=Date.now()) {
    this.assertOpen(now);const next=this.nextBot();if(!next)return false;
    this.record.game=this.gameAction(this.record.game,next.actor,next.action);this.record.revision++;this.record.updatedAt=now;return true;
  }
  metadata(now=Date.now()) {
    const r=this.record;if(r.closed)return {closed:true,closeReason:r.closeReason,serverNow:now};
    return {siteEdition:this.siteEdition,hostId:r.hostId,visibility:r.visibility,practice:r.practice,paused:r.paused,closed:false,minPlayers:r.game.phase==='lobby'?3:ruleProfile(r.game).minPlayers,maxPlayers:r.game.phase==='lobby'?6:ruleProfile(r.game).maxPlayers,expiresAt:this.deadline(),retentionReason:r.practice?'practice':r.paused?'paused':'host-offline',serverNow:now};
  }
  summary(code,now=Date.now()) {
    const r=this.record;if(r.closed || r.practice || r.visibility!=='public')return null;
    const profile=ruleProfile(r.game);
    return {code,hostName:r.game.players.find(p=>p.id===r.hostId)?.name || '房主',phase:r.game.phase,status:r.paused?'paused':r.game.phase==='lobby'?(r.game.players.length>=6?'full':'waiting'):r.game.phase==='finished'?'finished':'playing',playerCount:r.game.players.length,minPlayers:r.game.phase==='lobby'?3:profile.minPlayers,maxPlayers:r.game.phase==='lobby'?6:profile.maxPlayers,options:r.game.phase==='lobby'?optionsForPlayers(r.game.options,r.game.players.length):r.game.options||{friendlyRobber:false,harbormaster:false,playerExpansion:'base'},targetPoints:r.game.options?.harbormaster?11:10,expiresAt:this.deadline(),revision:r.revision};
  }
  snapshot(id,online=[],now=Date.now()) {
    if(this.record.closed)return {type:'closed',message:this.record.closeReason};
    if(!this.record.game.players.some(p=>p.id===id) || this.moderation?.restricted.includes(id))return {type:'removed',message:'原身份已失效，你已离开座位、被移出或受站长限制。'};
    this.enforceSitePolicy();const view=viewFor(this.record.game,id);
    return {type:'state',revision:this.record.revision,state:{...view,room:this.metadata(now),players:view.players.map(p=>({...p,online:p.bot || online.includes(p.id)})),chat:this.chatHistory(now),chatSequence:this.record.chatSequence}};
  }
}
