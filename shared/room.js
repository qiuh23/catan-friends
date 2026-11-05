import { createGame, addPlayer, act, viewFor, botAction, afford, total, ruleProfile } from './game.js';
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
  if (typeof token!=='string' || !/^[a-f\d-]{36,80}$/i.test(token)) throw new Error('登录凭证无效，请重新加入。');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
export class Room {
  constructor(record, now=Date.now()) {
    this.record=record || {version:2,game:createGame(),identities:{},revision:0,receipts:[],chat:[],updatedAt:now,createdAt:now,visibility:'public',practice:false};
    const r=this.record;if(r.closed)return;
    r.version=2;r.hostId ||= r.game.players[0]?.id || null;r.game.hostId=r.hostId;
    r.visibility ||= 'private';r.practice=!!r.practice;r.paused=!!r.paused;
    r.createdAt ??= r.updatedAt ?? now;r.hostSeenAt ??= r.updatedAt ?? now;
    r.hostConnected=!!r.hostConnected;r.hostOfflineAt ??= r.hostConnected ? null : (r.updatedAt ?? now);
    r.pauseOfflineAt ??= null;r.revoked ||= [];
  }
  assertOpen(now=Date.now()) {
    this.expire(now);
    if(this.record.closed)throw Object.assign(new Error(this.record.closeReason || '房间已关闭，请创建新房间。'),{code:'ROOM_CLOSED'});
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
    this.record={version:2,closed:true,closedAt:now,closeReason:reason,revision:r.revision+1,createdAt:r.createdAt};
  }
  join(hash,name,now=Date.now()) {
    this.assertOpen(now);const r=this.record;
    if(r.revoked.includes(hash))throw Object.assign(new Error('原身份已失效：你已离开座位或被房主移出，请使用新身份加入。'),{code:'IDENTITY_REVOKED'});
    let id=r.identities[hash];
    if(!id){
      if(r.practice && r.game.players.length)throw new Error('个人练习房不接受其他玩家。');
      id=crypto.randomUUID();addPlayer(r.game,id,name);r.identities[hash]=id;
      if(!r.hostId){r.hostId=id;r.game.hostId=id;}
      r.revision++;r.updatedAt=now;
    }
    return id;
  }
  revoke(id) {
    const r=this.record;
    for(const [hash,player] of Object.entries(r.identities))if(player===id){r.revoked.push(hash);delete r.identities[hash];}
    r.game.players=r.game.players.filter(p=>p.id!==id);r.game.players.forEach(p=>{p.ready=p.bot;});
  }
  handle(id,message,now=Date.now()) {
    this.assertOpen(now);const r=this.record;
    if(!message || typeof message.id!=='string' || !/^[\w-]{1,80}$/.test(message.id))throw new Error('操作编号无效。');
    if(!r.game.players.some(p=>p.id===id))throw Object.assign(new Error('原身份已失效，你不在这个房间中。'),{code:'IDENTITY_REVOKED'});
    if(r.receipts.some(v=>v.actor===id && v.id===message.id))return {type:'ack',id:message.id,ok:true};
    if(message.revision!==r.revision)throw new Error('棋盘已更新，请按最新状态重试。');
    const a=message.action,g=r.game;
    if(!a || typeof a.type!=='string')throw new Error('操作无效。');
    const host=r.hostId===id;
    if(a.type==='start' && this.online && g.players.some(p=>!p.bot && !this.online.includes(p.id)))throw new Error('请等待所有真人玩家在线并准备后再开局。');
    if(['addBot','removeBot','rematch','kick','transferHost','configure','setOptions','close','pause','resume'].includes(a.type) && !host)throw new Error('只有房主可以执行此操作。');
    if(r.paused && !['chat','leave','close','resume','transferHost'].includes(a.type))throw new Error('房主已暂停对局，请等待恢复。');
    if(a.type==='close'){this.close(undefined,now);return {type:'ack',id:message.id,ok:true};}
    if(a.type==='pause'){
      if(r.practice || ['lobby','finished'].includes(g.phase))throw new Error('只有进行中的真人房可以暂停。');
      r.paused=true;r.pauseOfflineAt=null;
    } else if(a.type==='resume'){r.paused=false;r.pauseOfflineAt=null;
    } else if(a.type==='transferHost'){
      const p=g.players.find(p=>p.id===a.playerId && !p.bot && p.id!==id);if(!p)throw new Error('请选择另一位真人玩家。');
      r.hostId=p.id;g.hostId=p.id;r.hostConnected=false;r.hostOfflineAt=now;r.hostSeenAt=now;
    } else if(a.type==='leave'){
      if(g.phase==='lobby'){if(host)throw new Error('请先转交房主，或确认解散房间。');this.revoke(id);}
    } else if(a.type==='kick' || a.type==='removeBot'){
      if(g.phase!=='lobby')throw new Error('只能在开局前移除玩家。');
      const p=g.players.find(p=>p.id===a.playerId);if(!p || p.id===r.hostId || (a.type==='removeBot' && !p.bot))throw new Error('不能移除此玩家。');this.revoke(p.id);
    } else if(a.type==='configure' || a.type==='setOptions'){
      if(g.phase!=='lobby')throw new Error('只能在开局前修改房间设置。');
      if(a.visibility!==undefined && !['public','private'].includes(a.visibility))throw new Error('房间可见性无效。');
      r.game=a.options===undefined ? g : act(g,id,{type:'setOptions',options:a.options});
      if(a.visibility!==undefined)r.visibility=a.visibility;r.game.players.forEach(p=>{p.ready=p.bot;});
    } else if(a.type==='addBot'){
      addPlayer(g,crypto.randomUUID(),['松林','麦田','远山'][g.players.filter(p=>p.bot).length] || '海风',true);
    } else if(a.type==='rematch'){
      if(g.phase!=='finished')throw new Error('本局结束后才能重新开局。');
      const next=createGame(g.options);for(const p of g.players)addPlayer(next,p.id,p.name,p.bot);next.hostId=r.hostId;r.game=next;
    } else if(a.type==='chat'){
      if(typeof a.text!=='string' || !a.text.trim() || a.text.length>200)throw new Error('消息需要 1–200 个字符。');
      r.chat.push({id:crypto.randomUUID(),playerId:id,name:g.players.find(p=>p.id===id).name,text:a.text.trim()});r.chat=r.chat.slice(-50);
    } else r.game=act(g,id,a);
    r.revision++;r.updatedAt=now;r.receipts.push({actor:id,id:message.id});r.receipts=r.receipts.slice(-256);
    return {type:'ack',id:message.id,ok:true};
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
    this.record.game=act(this.record.game,next.actor,next.action);this.record.revision++;this.record.updatedAt=now;return true;
  }
  metadata(now=Date.now()) {
    const r=this.record;if(r.closed)return {closed:true,closeReason:r.closeReason,serverNow:now};
    return {hostId:r.hostId,visibility:r.visibility,practice:r.practice,paused:r.paused,closed:false,minPlayers:ruleProfile(r.game).minPlayers,maxPlayers:ruleProfile(r.game).maxPlayers,expiresAt:this.deadline(),retentionReason:r.practice?'practice':r.paused?'paused':'host-offline',serverNow:now};
  }
  summary(code,now=Date.now()) {
    const r=this.record;if(r.closed || r.practice || r.visibility!=='public')return null;
    const profile=ruleProfile(r.game);
    return {code,hostName:r.game.players.find(p=>p.id===r.hostId)?.name || '房主',phase:r.game.phase,status:r.paused?'paused':r.game.phase==='lobby'?(r.game.players.length>=profile.maxPlayers?'full':'waiting'):r.game.phase==='finished'?'finished':'playing',playerCount:r.game.players.length,minPlayers:profile.minPlayers,maxPlayers:profile.maxPlayers,options:r.game.options||{friendlyRobber:false,harbormaster:false,playerExpansion:'base'},targetPoints:r.game.options?.harbormaster?11:10,expiresAt:this.deadline(),revision:r.revision};
  }
  snapshot(id,online=[],now=Date.now()) {
    if(this.record.closed)return {type:'closed',message:this.record.closeReason};
    if(!this.record.game.players.some(p=>p.id===id))return {type:'removed',message:'原身份已失效，你已离开座位或被房主移出。'};
    const view=viewFor(this.record.game,id);
    return {type:'state',revision:this.record.revision,state:{...view,room:this.metadata(now),players:view.players.map(p=>({...p,online:p.bot || online.includes(p.id)})),chat:this.record.chat}};
  }
}
