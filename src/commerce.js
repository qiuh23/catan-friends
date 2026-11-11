import {RESOURCES} from '../shared/board.js';
import {COSTS,afford} from '../shared/game.js';

export const buildNames={road:'道路',settlement:'村庄',city:'城市',development:'发展卡'};
export function normalizeTradeDraft(s,draft){
  const hand=s.players.find(p=>p.id===s.me).hand,maximum=s.profile?.resourceCount||19;
  for(const r of RESOURCES){
    const give=Math.max(0,Math.min(hand[r],Math.floor(Number(draft.get('give-'+r)))||0));
    const want=give?0:Math.max(0,Math.min(maximum,Math.floor(Number(draft.get('want-'+r)))||0));
    draft.set('give-'+r,String(give));draft.set('want-'+r,String(want));
  }
}
export function tradeRestriction(s,players=false){
  if(s.room?.paused)return '对局已暂停';
  if(s.phase!=='action')return '掷骰并处理当前任务后可交易';
  if(players&&s.pairStep==='secondary')return '配对建设阶段可使用银行／港口';
  if(s.players[s.turn]?.id!==s.me)return players&&s.offer?.from!==s.me&&s.offer?'':'等待你的行动阶段';
  return '';
}
export function buildAvailability(s,k){
  const p=s.players.find(p=>p.id===s.me),free=(k==='settlement'&&s.phase==='setup-settlement')||(k==='road'&&['setup-road','road-building'].includes(s.phase));
  const cost=free?{}:COSTS[k];
  let reason='';
  if(s.room?.paused)reason='对局已暂停';
  else if(s.players[s.turn]?.id!==s.me)reason='等待你的回合';
  else if(!free&&s.phase!=='action')reason='当前不是行动阶段';
  else if(k==='development'&&!s.deckCount)reason='发展卡已售罄';
  else if(k!=='development'){
    const stock=k==='road'?15-s.board.edges.filter(e=>e.owner===s.me).length:(k==='city'?4:5)-s.board.vertices.filter(v=>v.owner===s.me&&v.level===(k==='city'?2:1)).length;
    if(stock<=0)reason='该类棋子已用完';
    else if(!s.legal[k]?.length)reason='没有合法建造位置';
  }
  if(!reason&&!afford(p.hand,cost))reason='资源不足';
  return {free,cost,reason,can:!reason};
}
