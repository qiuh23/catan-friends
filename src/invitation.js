import { FOREIGN_INVITATION } from '../shared/site-policy.js';
import { LOBBY_URL, DOMESTIC } from './site-config.js';
const pattern=/^[A-HJ-NP-Z2-9]{6}$/;
const prefixes={aliyun:'A',cloudflare:'C'};
export const lobbyOrigins=DOMESTIC?{aliyun:LOBBY_URL}:{cloudflare:LOBBY_URL};

export function readRoom(value,backendId) {
  const text=String(value??'').trim().toUpperCase();
  const prefixed=/^([AC])-([A-HJ-NP-Z2-9]{6})$/.exec(text);
  if(prefixed){
    if(prefixes[backendId]!==prefixed[1])throw new Error(FOREIGN_INVITATION);
    return prefixed[2];
  }
  if(!pattern.test(text))throw new Error('请输入 6 位房间码，或带本站前缀的原始邀请码。');
  return text; // Historical bare codes remain scoped to the current origin.
}

export function readInvitation(search,backendId) {
  const params=new URLSearchParams(search);
  for(const key of ['room','server','watch','spectate'])if(params.getAll(key).length>1)throw new Error('邀请包含重复参数，请使用原始邀请链接。');
  if(params.has('watch')||params.has('spectate'))throw new Error('卡坦岛暂不支持观战，请使用加入房间邀请。');
  if(params.has('server')&&params.get('server')!==backendId)throw new Error(FOREIGN_INVITATION);
  return params.has('room')?readRoom(params.get('room'),backendId):'';
}

export function invitationURL(origin,code,backendId) {
  if(!pattern.test(code))throw new Error('房间码无效。');
  const url=new URL('/',origin);
  url.searchParams.set('room',prefixes[backendId]?`${prefixes[backendId]}-${code}`:code);
  return url.href;
}
