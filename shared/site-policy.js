import { UserError } from './errors.js';

// Stable IDs are independent of names, credentials, seats and the game RNG.
export const NICKNAMES = Object.freeze(['白塔','拱桥','穹顶','回廊','露台','钟楼','石阶','庭院','花窗','飞檐','石柱','天井','门廊','青瓦','长亭','拱门','水彩','素描','油画','版画','壁画','浮雕','陶艺','彩绘','剪影','留白','光影','线条','拼贴','釉彩','群青','朱砂'].map((name,index)=>Object.freeze({id:`catan-${String(index+1).padStart(2,'0')}`,name})));
export const COMMUNICATION_DISABLED='当前站点不提供玩家交流功能。';
export const FOREIGN_INVITATION='此邀请不属于当前站点，请向房主确认原始邀请链接。';
export function siteEdition(value,backendId='local') {
  if(value===undefined && backendId==='local')return 'global';
  if(!['cn','global'].includes(value))throw new Error('SITE_EDITION must explicitly be cn or global.');
  if(backendId==='aliyun'&&value!=='cn'||backendId==='cloudflare'&&value!=='global')throw new Error('SITE_EDITION does not match deployment target.');
  return value;
}
export function randomNickname(exclude) {
  const names=NICKNAMES.filter(n=>n.id!==exclude);
  return names[crypto.getRandomValues(new Uint32Array(1))[0]%names.length];
}
export function assignNickname(players,preferred) {
  const unused=NICKNAMES.filter(n=>!players.some(p=>p.nicknameId===n.id));
  const candidate=unused.find(n=>n.id===preferred);
  const pool=unused.length?unused:NICKNAMES;
  const nickname=candidate||pool[crypto.getRandomValues(new Uint32Array(1))[0]%pool.length];
  const badges=players.filter(p=>p.nicknameId===nickname.id).map(p=>p.nicknameBadge||1);
  let badge=1;while(badges.includes(badge))badge++;
  return {nicknameId:nickname.id,name:nickname.name,...(badge>1?{nicknameBadge:badge}:{})};
}
export function rejectCommunication(edition,message) {
  if(edition!=='cn')return;
  const action=message?.action||message;
  if(/chat|message|phrase|emoji|reaction|emote/i.test(message?.type||'') || /chat|message|phrase|emoji|reaction|emote/i.test(action?.type||'') || ['phraseId','emojiId','text','body','message'].some(key=>Object.hasOwn(action||{},key)||Object.hasOwn(message||{},key)))throw new UserError(COMMUNICATION_DISABLED);
}
export function validateNicknameInput(name,nicknameId) {
  if(name!==undefined || nicknameId!==undefined&&!NICKNAMES.some(n=>n.id===nicknameId))throw new UserError('当前站点仅接受本游戏固定昵称编号。');
}
