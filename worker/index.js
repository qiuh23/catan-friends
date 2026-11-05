import { Room, roomCode, fingerprint, ROOM_TTL } from '../shared/room.js';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export default {
  async fetch(request,env) {
    const url=new URL(request.url), origin=request.headers.get('Origin');
    const backendId=env.BACKEND_ID||'local',publicOrigin=env.PUBLIC_ORIGIN||'';
    if(!['local','cloudflare'].includes(backendId)||backendId==='cloudflare'&&!publicOrigin)return json({error:'服务器入口配置不完整。'},503);
    if(publicOrigin){
      try {const expected=new URL(publicOrigin);if(expected.origin!==publicOrigin||expected.protocol!=='https:'||expected.username||expected.password||publicOrigin!==url.origin)throw Error();}
      catch{return json({error:'服务器入口配置与当前来源不一致。'},503);}
    }
    if(url.pathname.startsWith('/api/') && origin && origin!==(publicOrigin||url.origin)) return json({error:'不允许的请求来源。'},403);
    const revision=env.BUILD_SHA||null;
    if(revision&&!/^[a-f0-9]{40}$/.test(revision))return json({error:'发布版本配置无效。'},503);
    const marker={ok:true,game:'catan-friends',backendId,revision};
    if(url.pathname==='/api/health') return json(marker);
    if(url.pathname==='/api/deployment') return json({...marker,publicOrigin:publicOrigin||null});
    if(url.pathname.startsWith('/api/')){
      if(!env.CATAN_RATE_LIMITER && backendId==='cloudflare')return json({error:'请求限流配置尚未就绪。'},503);
      if(env.CATAN_RATE_LIMITER){
        try {const result=await env.CATAN_RATE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});if(!result.success)return json({error:'请求过于频繁，请稍后重试。'},429);}
        catch{return json({error:'限流服务暂不可用。'},503);}
      }
    }
    if(url.pathname==='/api/connectivity/ws'){
      if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'需要 WebSocket 连接。'},426);
      const [client,server]=Object.values(new WebSocketPair());server.accept();server.send(JSON.stringify(marker));server.close(1000,'Connectivity checked');
      return new Response(null,{status:101,webSocket:client});
    }
    if(url.pathname==='/api/rooms' && request.method==='POST') {
      const code=roomCode(), stub=env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(new Request(`${url.origin}/create?code=${code}`,request));
    }
    const match=/^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})\/ws$/.exec(url.pathname);
    if(match) return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
    if(url.pathname.startsWith('/api/')) return json({error:'接口不存在。'},404);
    return env.ASSETS.fetch(request);
  }
};
export class CatanRoom {
  constructor(ctx,env) {
    this.ctx=ctx;this.env=env;this.queue=Promise.resolve();
    ctx.blockConcurrencyWhile(async()=>{const record=await ctx.storage.get('room');this.room=record ? new Room(record) : null;});
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}','{"type":"pong"}'));
  }
  serial(fn){const p=this.queue.then(fn);this.queue=p.catch(()=>{});return p;}
  peers(){return this.ctx.getWebSockets().filter(ws=>ws.deserializeAttachment()?.id);}
  send(ws,data){try{ws.send(JSON.stringify(data));}catch{}}
  broadcast(){if(!this.room)return;const peers=this.peers(),online=peers.map(ws=>ws.deserializeAttachment().id);for(const ws of peers)this.send(ws,this.room.snapshot(ws.deserializeAttachment().id,online));}
  async persist(){await this.ctx.storage.put('room',this.room.record);await this.ctx.storage.setAlarm(Date.now()+(this.peers().length && this.room.nextBot()?900:ROOM_TTL));}
  fetch(request){return this.serial(async()=>{
    try {
      const url=new URL(request.url);
      if(url.pathname==='/create') {
        if(this.room)return json({error:'房间码冲突，请重试。'},409);
        const raw=await request.text();if(raw.length>8192)throw new Error('请求过大。');const input=JSON.parse(raw), hash=await fingerprint(input.token);
        const room=new Room(),id=room.join(hash,input.name);this.room=room;
        if(input.practice===true){for(let i=0;i<2;i++)room.handle(id,{id:crypto.randomUUID(),revision:room.record.revision,action:{type:'addBot'}});room.handle(id,{id:crypto.randomUUID(),revision:room.record.revision,action:{type:'start'}});}
        await this.persist();return json({code:url.searchParams.get('code')},201);
      }
      if(!this.room || Date.now()-this.room.record.updatedAt>ROOM_TTL)return json({error:'房间不存在或已过期。'},404);
      if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'需要 WebSocket 连接。'},426);
      if(this.ctx.getWebSockets().length>=16)return json({error:'房间连接过多，请稍后重试。'},429);
      const [client,server]=Object.values(new WebSocketPair());this.ctx.acceptWebSocket(server);server.serializeAttachment({id:null,n:0,window:Date.now()});
      return new Response(null,{status:101,webSocket:client});
    }catch(error){return json({error:error.message},400);}
  });}
  webSocketMessage(ws,raw){return this.serial(async()=>{
    let message, before;
    try {
      if(typeof raw!=='string'||raw.length>8192)throw new Error('消息过大。');
      const session=ws.deserializeAttachment();if(Date.now()-session.window>10000){session.window=Date.now();session.n=0;}if(++session.n>60)throw new Error('操作过于频繁。');ws.serializeAttachment(session);
      message=JSON.parse(raw);if(!this.room)throw new Error('房间已关闭。');before=structuredClone(this.room.record);
      if(!session.id){
        if(message.type!=='hello')throw new Error('请先加入房间。');
        session.id=this.room.join(await fingerprint(message.token),message.name);this.room.record.updatedAt=Date.now();
        await this.persist();ws.serializeAttachment(session);
        for(const other of this.peers())if(other!==ws && other.deserializeAttachment().id===session.id){this.send(other,{type:'replaced'});other.close(4001,'Session replaced');}
        await this.persist();this.broadcast();return;
      }
      if(message.type==='sync'){this.send(ws,this.room.snapshot(session.id,this.peers().map(w=>w.deserializeAttachment().id)));return;}
      if(message.type!=='action')throw new Error('消息类型无效。');
      const ack=this.room.handle(session.id,message);await this.persist();this.send(ws,ack);this.broadcast();
    }catch(error){if(before)this.room.record=before;this.send(ws,{type:'error',id:message?.id,message:error.message,fatal:!ws.deserializeAttachment()?.id});this.broadcast();}
  });}
  webSocketClose(){this.broadcast();}
  webSocketError(ws){ws.close(1011,'Connection error');}
  alarm(){return this.serial(async()=>{
    if(!this.room)return;
    if(this.peers().length && this.room.nextBot()){this.room.tick();await this.persist();this.broadcast();}
    else if(!this.peers().length && Date.now()-this.room.record.updatedAt>=ROOM_TTL){await this.ctx.storage.deleteAll();this.room=null;}
    else await this.ctx.storage.setAlarm(Date.now()+ROOM_TTL);
  });}
}
