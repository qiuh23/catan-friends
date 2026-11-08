import {RESOURCES,LABELS,total} from '../shared/board.js';
import {COSTS,afford,tradeRatio} from '../shared/game.js';
import {icon,resourceIllustration} from './icons.js';

export const buildNames={road:'道路',settlement:'村庄',city:'城市',development:'发展卡'};
export const escapeText=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
const bundleHTML=cards=>RESOURCES.filter(r=>cards[r]>0).map(r=>`<span class="exchange-resource ${r}">${resourceIllustration(r)}<b>${cards[r]}</b><span>${LABELS[r]}</span></span>`).join('');
const preview=(give,want)=>`<div class="exchange-preview" aria-label="交换预览"><div><small>你付出</small>${bundleHTML(give)||'<span class="empty-resource">选资源</span>'}</div><span aria-hidden="true">→</span><div><small>你获得</small>${bundleHTML(want)||'<span class="empty-resource">选资源</span>'}</div></div>`;
function tabs(items,selected,key){return `<div class="exchange-tabs" role="group" aria-label="${key==='tradeView'?'交易方式':'玩家交易视图'}">${items.map(([id,label])=>`<button type="button" data-${key==='tradeView'?'trade-view':'trade-page'}="${id}" aria-pressed="${selected===id}">${label}</button>`).join('')}</div>`;}
export function tradePanel(s,{draft,view='players',page='compose',busy=false}={}){
  const me=s.players.find(p=>p.id===s.me),offline=busy;
  const give=Object.fromEntries(RESOURCES.map(r=>[r,Math.min(me.hand[r],Number(draft.get(`give-${r}`))||0)]));
  const want=Object.fromEntries(RESOURCES.map(r=>[r,give[r]?0:Number(draft.get(`want-${r}`))||0]));
  const choose=(prefix,values)=>`<div class="exchange-resources">${RESOURCES.map(r=>{
    const max=prefix==='give'?me.hand[r]:s.profile?.resourceCount||19,n=values[r],other=(prefix==='give'?want:give)[r]>0;
    return `<div class="exchange-card ${r} ${n?'chosen':''}"><button type="button" class="resource-pick" data-resource="${r}" data-side="${prefix}" data-delta="1" aria-label="增加${prefix==='give'?'付出':'获得'}${LABELS[r]}" ${other||n>=max?'disabled':''}>${resourceIllustration(r)}<span>${LABELS[r]}</span>${prefix==='give'?`<small>持有 ${me.hand[r]}</small>`:''}</button><div class="exchange-stepper"><button type="button" data-resource="${r}" data-side="${prefix}" data-delta="-1" aria-label="减少${prefix==='give'?'付出':'获得'}${LABELS[r]}" ${!n?'disabled':''}>−</button><output aria-label="${LABELS[r]}已选 ${n}">${n}</output><button type="button" data-resource="${r}" data-side="${prefix}" data-delta="1" aria-label="增加${prefix==='give'?'付出':'获得'}${LABELS[r]}" ${other||n>=max?'disabled':''}>+</button></div></div>`;
  }).join('')}</div>`;
  let body='';
  if(view==='bank'){
    const from=draft.get('bank-give')||'wood',to=draft.get('bank-want')||'ore',ratio=tradeRatio(s,s.me,from);
    const reason=tradeRestriction(s)|| (from===to?'选择两种不同资源':me.hand[from]<ratio?'付款资源不足':!s.bank[to]?'银行暂时缺货':'');
    const row=(side,selected)=>`<div class="exchange-resources bank-choices">${RESOURCES.map(r=>`<button type="button" class="exchange-card ${r} ${selected===r?'chosen':''}" data-bank-side="${side}" data-resource="${r}" aria-pressed="${selected===r}">${resourceIllustration(r)}<span>${LABELS[r]}</span><small>${side==='give'?`持有 ${me.hand[r]}`:s.bank[r]?`库存 ${s.bank[r]}`:'缺货'}</small></button>`).join('')}</div>`;
    body=`<div class="exchange-body"><h3>我付出 <small class="rate-source">${icon(ratio===4?'trade':'harbor')}${ratio===4?'银行':ratio===3?'普通港':'专属港'} ${ratio}:1</small></h3>${row('give',from)}<h3>我想获得</h3>${row('want',to)}</div><div class="exchange-footer">${preview({[from]:ratio},{[to]:1})}${reason?`<p class="exchange-reason" role="status">${reason}</p>`:''}<button class="primary" data-action="exchangeBank" ${reason||offline?'disabled':''}>兑换 1 张${LABELS[to]}</button></div>`;
  } else {
    const restriction=tradeRestriction(s,true),isMine=s.offer?.from===s.me;
    const canCompose=s.players[s.turn]?.id===s.me&&!restriction;
    body=tabs([['compose','发起交易'],['offers',`当前报价${s.offer?' · 1':''}`]],page,'tradePage');
    if(page==='compose'){
      const reason=!canCompose?(restriction||'等待你的回合，可查看当前报价'):!total(give)||!total(want)?'两边各选至少一种资源':'';
      body+=`<div class="exchange-body"><h3>我付出</h3>${choose('give',give)}<h3>我想获得</h3>${choose('want',want)}</div><div class="exchange-footer">${preview(give,want)}${reason?`<p class="exchange-reason" role="status">${reason}</p>`:''}<button class="primary" data-action="publishTrade" ${reason||offline?'disabled':''}>${s.offer?'发布并替换当前报价':'发布公开报价'}</button></div>`;
    }else{
      const o=s.offer,reason=restriction||(!isMine&&o&&!afford(me.hand,o.want)?'你的付款资源不足':'');
      body+=o?`<div class="exchange-body current-offer"><h3>${isMine?'你发出的报价':`${escapeText(s.players.find(p=>p.id===o.from)?.name)} 的报价`}</h3>${preview(isMine?o.give:o.want,isMine?o.want:o.give)}<p>${isMine?'等待其他玩家接受':'接受后立即成交'}</p></div><div class="exchange-footer"><p class="exchange-reason" role="status">${reason||'资源未锁定，成交以最新状态为准'}</p><button class="${isMine?'secondary':'primary'}" data-action="${isMine?'cancelTrade':'acceptTrade'}" data-offer-id="${escapeText(o.id)}" ${reason||offline?'disabled':''}>${isMine?'撤销报价':'接受并成交'}</button></div>`:`<div class="exchange-body exchange-empty">${icon('trade')}<p>暂无公开报价</p></div>`;
    }
  }
  return `<section class="exchange" aria-label="资源交易">${tabs([['players','玩家交易'],['bank','银行／港口']],view,'tradeView')}${body}</section>`;
}
export function costPanel(s,k){
  const info=buildAvailability(s,k),me=s.players.find(p=>p.id===s.me);
  return `<section class="build-cost" role="region" aria-label="${buildNames[k]}费用"><div class="cost-heading"><strong>${icon(k)}${buildNames[k]}${info.free?' · 本次免费':''}</strong><button type="button" data-action="closeCost" aria-label="关闭费用">×</button></div>${info.free?'':`<div class="cost-resources">${Object.entries(info.cost).map(([r,n])=>`<span class="${r} ${me.hand[r]<n?'short':''}">${resourceIllustration(r)}<b>需 ${n} / 有 ${me.hand[r]}</b><small>${me.hand[r]<n?'差 '+(n-me.hand[r]):'✓ 足够'}</small></span>`).join('')}</div>`}<p role="status">${info.reason||(k==='development'?'确认费用后购买':'点击地图上的亮起位置建造')}</p>${k==='development'?`<button class="primary" data-action="buyDevelopment" ${!info.can?'disabled':''}>购买发展卡</button>`:''}</section>`;
}
export function awardPanel(s){
  return `<div class="award-progress">${[['longest','road','最长道路','roadLength',5],['army','knight','最大军队','knights',3],...(s.options?.harbormaster?[['harbormaster','harbor','卡坦港口','harborPoints',3]]:[])].map(([key,glyph,label,stat,min])=>{
    const holder=s.players.find(p=>p.id===s[key]);
    return `<section><h3>${icon(glyph)}${label}<b>+2 分</b></h3><p>${holder?escapeText(holder.name)+' 持有':`待获得 · 门槛 ${min}`}</p><div>${s.players.map(p=>`<span style="--player:${p.color}" class="${s[key]===p.id?'award-holder':''}">${escapeText(p.name)} <b>${p[stat]||0}</b> / ${min}</span>`).join('')}</div></section>`;
  }).join('')}</div>`;
}
