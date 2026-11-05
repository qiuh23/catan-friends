const pattern=/^[A-HJ-NP-Z2-9]{6}$/;
const prefixes={aliyun:'A',cloudflare:'C'};
export const lobbyOrigins={aliyun:'https://magical-athlete-online.cn/',cloudflare:'https://magical-athlete.qiuh23.workers.dev/lobby/'};

export function readRoom(value,backendId) {
  const text=String(value??'').trim().toUpperCase();
  const prefixed=/^([AC])-([A-HJ-NP-Z2-9]{6})$/.exec(text);
  if(prefixed){
    if(prefixes[backendId]!==prefixed[1])throw new Error('邀请属于另一台服务器。请打开创建房间时的原始邀请链接；房间和身份不能跨服迁移。');
    return prefixed[2];
  }
  if(!pattern.test(text))throw new Error('请输入 6 位房间码，或带 A-/C- 前缀的原始邀请码。');
  return text; // Historical bare codes remain scoped to the current origin.
}

export function readInvitation(search,backendId) {
  const params=new URLSearchParams(search);
  for(const key of ['room','server','watch','spectate'])if(params.getAll(key).length>1)throw new Error('邀请包含重复参数，请使用原始邀请链接。');
  if(params.has('watch')||params.has('spectate'))throw new Error('卡坦岛暂不支持观战，请使用加入房间邀请。');
  if(params.has('server')&&params.get('server')!==backendId)throw new Error('邀请服务器与当前入口不一致，请使用原始邀请链接。');
  return params.has('room')?readRoom(params.get('room'),backendId):'';
}

export function invitationURL(origin,code,backendId) {
  if(!pattern.test(code))throw new Error('房间码无效。');
  const url=new URL('/',origin);
  url.searchParams.set('room',prefixes[backendId]?`${prefixes[backendId]}-${code}`:code);
  return url.href;
}
