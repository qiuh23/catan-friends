import { isIP } from 'node:net';

const loopback=address=>address==='127.0.0.1'||address==='::1'||address==='::ffff:127.0.0.1';

export function deploymentConfig({backendId='local',publicOrigin='',trustProxy=''}={}) {
  if(!['local','aliyun'].includes(backendId))throw new Error('BACKEND_ID must be local or aliyun.');
  if(!['','loopback'].includes(trustProxy))throw new Error('TRUST_PROXY must be empty or loopback.');
  if(publicOrigin){
    const url=new URL(publicOrigin);
    if(url.origin!==publicOrigin || url.username || url.password || (url.protocol!=='https:' && !(backendId==='local'&&url.protocol==='http:')))throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin.');
  }
  if(backendId==='aliyun'&&!publicOrigin)throw new Error('PUBLIC_ORIGIN is required for Aliyun.');
  return {backendId,publicOrigin,trustProxy};
}

export function requestAddress(req,trustProxy='') {
  const direct=req.socket.remoteAddress||'unknown';
  // Only the local Nginx may replace this header. Never consume X-Forwarded-For,
  // Forwarded or CF-Connecting-IP supplied by an arbitrary remote peer.
  if(trustProxy==='loopback'&&loopback(direct)){
    const header=req.headers['x-real-ip'];
    if(typeof header==='string'&&isIP(header))return header;
  }
  return direct;
}

export function originAllowed(req,publicOrigin='') {
  if(!req.headers.origin)return true; // CLI/health clients do not carry browser authority.
  const expected=publicOrigin||`http://${req.headers.host}`;
  try {const url=new URL(req.headers.origin);return url.origin===req.headers.origin&&url.origin===expected;}catch{return false;}
}
