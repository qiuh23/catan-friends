import { createGame, addPlayer, act, viewFor, botAction, afford, total } from './game.js';
export const ROOM_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
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
  constructor(record) { this.record=record || { version:1, game:createGame(), identities:{}, revision:0, receipts:[], chat:[], updatedAt:Date.now() }; }
  join(hash,name) {
    let id=this.record.identities[hash];
    if(!id) { id=crypto.randomUUID(); addPlayer(this.record.game,id,name); this.record.identities[hash]=id; this.record.revision++; }
    return id;
  }
  handle(id,message) {
    if(!message || typeof message.id!=='string' || !/^[\w-]{1,80}$/.test(message.id)) throw new Error('操作编号无效。');
    if(this.record.receipts.some(r=>r.actor===id && r.id===message.id)) return {type:'ack',id:message.id,ok:true};
    if(message.revision!==this.record.revision) throw new Error('棋盘已更新，请按最新状态重试。');
    const a=message.action, g=this.record.game;
    if(!a || typeof a.type!=='string') throw new Error('操作无效。');
    if(!g.players.some(p=>p.id===id)) throw new Error('你不在这个房间中。');
    const host=g.players[0].id===id;
    if(['addBot','removeBot','rematch'].includes(a.type) && !host) throw new Error('只有房主可以执行此操作。');
    if(a.type==='addBot') {
      addPlayer(g,crypto.randomUUID(),['松林','麦田','远山'][g.players.filter(p=>p.bot).length] || '海风',true);
    } else if(a.type==='removeBot') {
      if(g.phase!=='lobby') throw new Error('对局已经开始。');
      const p=g.players.find(p=>p.id===a.playerId); if(!p?.bot) throw new Error('只能移除电脑玩家。');
      g.players=g.players.filter(p=>p.id!==a.playerId);
    } else if(a.type==='rematch') {
      if(g.phase!=='finished') throw new Error('本局结束后才能重新开局。');
      const next=createGame(); for(const p of g.players) addPlayer(next,p.id,p.name,p.bot); this.record.game=next;
    } else if(a.type==='chat') {
      if(typeof a.text!=='string' || !a.text.trim() || a.text.length>200) throw new Error('消息需要 1–200 个字符。');
      this.record.chat.push({id:crypto.randomUUID(),playerId:id,name:g.players.find(p=>p.id===id).name,text:a.text.trim()}); this.record.chat=this.record.chat.slice(-50);
    } else this.record.game=act(g,id,a);
    this.record.revision++; this.record.updatedAt=Date.now();
    this.record.receipts.push({actor:id,id:message.id}); this.record.receipts=this.record.receipts.slice(-256);
    return {type:'ack',id:message.id,ok:true};
  }
  nextBot() {
    const g=this.record.game;
    if(['lobby','finished'].includes(g.phase)) return null;
    if(g.phase==='action' && g.offer && total(g.offer.give)>=total(g.offer.want) && afford(g.players.find(p=>p.id===g.offer.from).hand,g.offer.give)) {
      const buyer=g.players.find(p=>p.bot && p.id!==g.offer.from && afford(p.hand,g.offer.want));
      if(buyer)return {actor:buyer.id,action:{type:'acceptTrade',offerId:g.offer.id}};
    }
    const p=g.phase==='discard' ? g.players.find(p=>p.bot && g.discards[p.id]) : g.players[g.turn];
    if(!p?.bot) return null;
    const action=botAction(g,p.id); return action ? {actor:p.id,action} : null;
  }
  tick() { const next=this.nextBot(); if(!next) return false; this.record.game=act(this.record.game,next.actor,next.action); this.record.revision++; this.record.updatedAt=Date.now(); return true; }
  snapshot(id,online=[]) {
    const view=viewFor(this.record.game,id);
    return {type:'state',revision:this.record.revision,state:{...view,players:view.players.map(p=>({...p,online:p.bot || online.includes(p.id)})),chat:this.record.chat}};
  }
}
