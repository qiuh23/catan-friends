import { Room, roomCode, fingerprint, ROOM_PATTERN } from '../shared/room.js';
import { UserError,publicError } from '../shared/errors.js';
import { securityConfig,adminAuthorized,emptyModeration,pruneModeration,applyModeration,disposition,inspectRoom,closedModeration } from '../shared/moderation.js';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const directory=env=>env.ROOMS.get(env.ROOMS.idFromName('__public_rooms_v1__'));
export default {
  async fetch(request,env) {
    const url=new URL(request.url),origin=request.headers.get('Origin');
    const backendId=env.BACKEND_ID||'local',publicOrigin=env.PUBLIC_ORIGIN||'';
    if(!['local','cloudflare'].includes(backendId)||backendId==='cloudflare'&&!publicOrigin)return json({error:'服务器入口配置不完整。'},503);
    if(publicOrigin){try{const expected=new URL(publicOrigin);if(expected.origin!==publicOrigin||expected.protocol!=='https:'||expected.username||expected.password||publicOrigin!==url.origin)throw Error();}catch{return json({error:'服务器入口配置与当前来源不一致。'},503);}}
    if(url.pathname.startsWith('/api/') && origin && origin!==(publicOrigin||url.origin))return json({error:'不允许的请求来源。'},403);
    const revision=env.BUILD_SHA||null;
    if(revision&&!/^[a-f0-9]{40}$/.test(revision))return json({error:'发布版本配置无效。'},503);
    const marker={ok:true,game:'catan-friends',backendId,revision};
    if(url.pathname==='/api/health')return json(marker);
    if(url.pathname==='/api/deployment')return json({...marker,publicOrigin:publicOrigin||null});
    if(url.pathname==='/api/security/contact')return json(securityConfig(env));
    if(url.pathname.startsWith('/api/')){
      if(!env.CATAN_RATE_LIMITER && backendId==='cloudflare')return json({error:'请求限流配置尚未就绪。'},503);
      if(env.CATAN_RATE_LIMITER){try{const result=await env.CATAN_RATE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});if(!result.success)return json({error:'请求过于频繁，请稍后重试。'},429);}catch{return json({error:'限流服务暂不可用。'},503);}}
    }
    if(url.pathname==='/api/connectivity/ws'){
      if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'需要 WebSocket 连接。'},426);
      const [client,server]=Object.values(new WebSocketPair());server.accept();server.send(JSON.stringify(marker));server.close(1000,'Connectivity checked');return new Response(null,{status:101,webSocket:client});
    }
    const admin=/^\/api\/stationmaster\/rooms\/([A-HJ-NP-Z2-9]{6})$/.exec(url.pathname);
    if(admin){
      if(!await adminAuthorized(request.headers.get('Authorization'),env))return json({error:'无站长权限或尚未配置。'},403);
      if(request.method!=='POST')return json({error:'需要 POST 请求。'},405);
      return env.ROOMS.get(env.ROOMS.idFromName(admin[1])).fetch(new Request(url.origin+'/stationmaster?code='+admin[1],request));
    }
    if(url.pathname==='/api/rooms' && request.method==='GET'){
      const cursor=url.searchParams.get('cursor');if(cursor && !ROOM_PATTERN.test(cursor))return json({error:'列表分页参数无效。'},400);
      try{
        const response=await directory(env).fetch(new Request(url.origin+'/directory'+(cursor?'?cursor='+cursor:'')));
        const {codes,nextCursor}=await response.json();
        // The directory is an index, never the authority. Revalidate visibility,
        // capacity and expiry in the owning room before exposing any entry.
        const entries=await Promise.all(codes.map(async code=>{const r=await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(url.origin+'/summary?code='+code));if(!r.ok)throw Error('Room listing unavailable');return r.json();}));
        return json({rooms:entries.filter(Boolean),nextCursor,serverNow:Date.now()});
      }catch{return json({error:'在线房间列表暂不可用，请刷新重试。'},503);}
    }
    if(url.pathname==='/api/rooms' && request.method==='POST'){
      const input=await request.text();if(input.length>8192)return json({error:'请求过大。'},400);
      for(let n=0;n<8;n++){
        const code=roomCode(),response=await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(url.origin+'/create?code='+code,{method:'POST',body:input}));if(response.status!==409)return response;
      }
      return json({error:'房间码分配失败，请重试。'},503);
    }
    const match=/^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})\/ws$/.exec(url.pathname);
    if(match)return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
    if(url.pathname.startsWith('/api/'))return json({error:'接口不存在。'},404);
    return env.ASSETS.fetch(request);
  }
};
export class CatanRoom {
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;this.queue=Promise.resolve();
    ctx.blockConcurrencyWhile(async()=>{
      try{
      const record=await ctx.storage.get('room');this.code=await ctx.storage.get('code');this.room=record?new Room(record):null;
      this.moderation=pruneModeration(await ctx.storage.get('moderation')||emptyModeration());
      if(this.room){applyModeration(this.room,this.moderation);this.room.presence(this.online(),Date.now(),true);await this.persist();}
      }catch{throw Error('ROOM_RECOVERY_FAILED');}
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}','{"type":"pong"}'));
  }
  serial(fn){const p=this.queue.then(fn);this.queue=p.catch(()=>{});return p;}
  seen(ws){const session=ws.deserializeAttachment();return Math.max(session?.lastSeen??session?.createdAt??0,this.ctx.getWebSocketAutoResponseTimestamp?.(ws)?.getTime()??0);}
  peers(exclude){return this.ctx.getWebSockets().filter(ws=>ws!==exclude && ws.readyState===1 && ws.deserializeAttachment()?.id && Date.now()-this.seen(ws)<90000);}
  online(exclude){return this.peers(exclude).map(ws=>ws.deserializeAttachment().id);}
  send(ws,data){try{ws.send(JSON.stringify(data));}catch{}}
  broadcast(){if(!this.room)return;const peers=this.peers(),online=this.online();for(const ws of peers){const state=this.room.snapshot(ws.deserializeAttachment().id,online);this.send(ws,state);if(state.type!=='state'){const s=ws.deserializeAttachment();s.id=null;ws.serializeAttachment(s);ws.close(4003,'Room membership ended');}}}
  async persist(){
    if(!this.room)return;
    const moderation=this.room.record.closed?closedModeration(this.moderation||emptyModeration()):this.moderation;
    let next=this.room.deadline();
    const expiry=this.moderation?.audit.filter(event=>!event.held).reduce((min,event)=>Math.min(min,event.expiresAt),Infinity);
    if(Number.isFinite(expiry))next=Math.min(next??Infinity,expiry);
    if(!this.room.record.closed && this.peers().length){const wake=Date.now()+(this.room.nextBot()?900:30000);next=next===null?wake:Math.min(next,wake);}
    // Also collect sockets which upgraded but never authenticated.
    for(const ws of this.ctx.getWebSockets())if(ws.readyState===1 && !ws.deserializeAttachment()?.id){const wake=(ws.deserializeAttachment()?.createdAt??Date.now())+10000;next=next===null?wake:Math.min(next,wake);}
    // This class already uses SQLite storage. Commit the state and its next
    // lifecycle alarm together; a failed alarm write cannot leave a saved move
    // acknowledged only in memory or a live room without expiry scheduling.
    await this.ctx.storage.transaction(async()=>{
      await this.ctx.storage.put('room',this.room.record);
      if(moderation)await this.ctx.storage.put('moderation',moderation);
      if(this.code)await this.ctx.storage.put('code',this.code);
      if(next!==null)await this.ctx.storage.setAlarm(Math.max(Date.now()+1,next));else await this.ctx.storage.deleteAlarm();
    });
    this.moderation=moderation;
    if(this.code){
      const summary=this.room.summary(this.code);
      // A directory outage must not roll back an already persisted authoritative command.
      try{const response=await directory(this.env).fetch(new Request('https://internal/directory',{method:'POST',body:JSON.stringify({code:this.code,summary,revision:this.room.record.revision})}));if(!response.ok)throw Error('Directory unavailable');}catch{console.error('DIRECTORY_UPDATE_FAILED');try{await this.ctx.storage.setAlarm(Math.max(Date.now()+1,Math.min(this.room.deadline()??Infinity,Date.now()+30000)));}catch{console.error('DIRECTORY_RETRY_FAILED');}}
    }
  }
  async check(){
    if(this.room)applyModeration(this.room,this.moderation);
    if(this.room && !this.room.record.closed){
      const before=structuredClone(this.room.record);
      // Reads also reconcile socket leases. Otherwise a delayed alarm followed
      // by a list refresh could cancel the only alarm while hostConnected stayed true.
      this.room.presence(this.online(),Date.now(),true);
      try{await this.persist();}catch(error){this.room.record=before;throw error;}
      if(before.hostConnected!==this.room.record.hostConnected || this.room.record.closed)this.broadcast();
    }
    return this.room && !this.room.record.closed;
  }
  fetch(request){return this.serial(async()=>{
    try{
      const url=new URL(request.url);
      if(url.pathname==='/directory'){
        if(request.method==='POST'){
          const {code,summary,revision}=await request.json();if(!ROOM_PATTERN.test(code))return json({error:'Invalid code'},400);
          const key='entry:'+code,old=await this.ctx.storage.get(key);
          if(!old || revision>=old.revision)await this.ctx.storage.put(key,{revision,summary});return json({ok:true});
        }
        const entries=await this.ctx.storage.list({prefix:'entry:'});
        const cursor=url.searchParams.get('cursor'),visible=[...entries].filter(([key,v])=>v.summary && (!cursor || key.slice(6)>cursor)),page=visible.slice(0,40);
        return json({codes:page.map(([key])=>key.slice(6)),nextCursor:visible.length>40?page.at(-1)[0].slice(6):null});
      }
      this.code ||= url.searchParams.get('code') || /^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})\//.exec(url.pathname)?.[1];
      if(url.pathname==='/stationmaster'){
        if(!await adminAuthorized(request.headers.get('Authorization'),this.env))return json({error:'无站长权限或尚未配置。'},403);
        if(request.method!=='POST')return json({error:'需要 POST 请求。'},405);
        if(!this.room)return json({error:'房间不存在。'},404);
        const raw=await request.text();if(raw.length>8192)throw new UserError('请求过大。');
        const input=JSON.parse(raw),next=disposition(this.room,this.moderation,input,securityConfig(this.env));
        // A separate durable key survives a room tombstone or restoration of an
        // older game record. Commit the directive before applying the projection.
        await this.ctx.storage.put('moderation',next.state);this.moderation=next.state;
        applyModeration(this.room,this.moderation);this.room.presence(this.online());await this.persist();this.broadcast();
        return json(input.action==='inspect'?inspectRoom(this.room,this.moderation):next.result);
      }
      if(url.pathname==='/create'){
        if(this.room)return json({error:'房间码冲突，请重试。'},409);
        const raw=await request.text();if(raw.length>8192)throw Error('请求过大。');const input=JSON.parse(raw),hash=await fingerprint(input.token),room=new Room(),id=room.join(hash,input.name);
        room.record.practice=input.practice===true;room.handle(id,{id:crypto.randomUUID(),revision:room.record.revision,action:{type:'configure',visibility:input.visibility??'public',options:input.options}});
        if(input.practice===true){for(let i=1;i<room.metadata().minPlayers;i++)room.handle(id,{id:crypto.randomUUID(),revision:room.record.revision,action:{type:'addBot'}});room.handle(id,{id:crypto.randomUUID(),revision:room.record.revision,action:{type:'start'}});}
        this.room=room;try{await this.persist();}catch(error){this.room=null;throw error;}return json({code:this.code},201);
      }
      if(!await this.check()){
        if(this.room?.record.closed && request.headers.get('Upgrade')?.toLowerCase()==='websocket'){
          const [client,server]=Object.values(new WebSocketPair());server.accept();server.send(JSON.stringify({type:'closed',message:this.room.record.closeReason}));server.close(4003,'Room closed');return new Response(null,{status:101,webSocket:client});
        }
        return url.pathname==='/summary'?json(null):json({error:this.room?.record.closeReason || '房间不存在或已过期。'},404);
      }
      if(url.pathname==='/summary'){await this.persist();return json(this.room.summary(this.code));}
      if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'需要 WebSocket 连接。'},426);
      if(this.ctx.getWebSockets().filter(ws=>ws.readyState===1).length>=16)return json({error:'房间连接过多，请稍后重试。'},429);
      const [client,server]=Object.values(new WebSocketPair());this.ctx.acceptWebSocket(server);server.serializeAttachment({id:null,n:0,window:Date.now(),createdAt:Date.now()});await this.persist();return new Response(null,{status:101,webSocket:client});
    }catch(error){return json({error:publicError(error).message},error instanceof UserError?400:503);}
  });}
  webSocketMessage(ws,raw){return this.serial(async()=>{
    let message,before,oldSession;
    try{
      if(typeof raw!=='string'||raw.length>8192)throw Error('消息过大。');
      const session=ws.deserializeAttachment();oldSession={...session};
      if(Date.now()-session.window>10000){session.window=Date.now();session.n=0;}if(++session.n>60)throw Error('操作过于频繁。');ws.serializeAttachment(session);
      message=JSON.parse(raw);if(!await this.check())throw Error(this.room?.record.closeReason || '房间已关闭。');before=structuredClone(this.room.record);session.lastSeen=Date.now();ws.serializeAttachment(session);
      if(!session.id){
        if(message.type!=='hello')throw Error('请先加入房间。');session.id=this.room.join(await fingerprint(message.token),message.name);ws.serializeAttachment(session);
        this.room.presence(this.online());await this.persist();
        for(const other of this.peers())if(other!==ws && other.deserializeAttachment().id===session.id){this.send(other,{type:'replaced'});other.close(4001,'Session replaced');}
        this.broadcast();return;
      }
      if(message.type==='sync'){this.room.presence(this.online());await this.persist();this.broadcast();return;}
      if(message.type!=='action')throw Error('消息类型无效。');
      const ack=this.room.handle(session.id,message);
      if(message.action?.type==='leave'){session.id=null;ws.serializeAttachment(session);}
      this.room.presence(this.online());await this.persist();this.send(ws,ack);this.broadcast();if(message.action?.type==='leave')ws.close(1000,'Left room');
    }catch(error){
      if(before){this.room.record=before;if(oldSession)ws.serializeAttachment({...ws.deserializeAttachment(),id:oldSession.id});}
      const fatal=!ws.deserializeAttachment()?.id || this.room?.record.closed;this.send(ws,{type:'error',id:typeof message?.id==='string'?message.id.slice(0,80):undefined,...publicError(error),fatal});if(fatal)ws.close(1008,'Join failed');else this.broadcast();
    }
  });}
  webSocketClose(ws){return this.serial(async()=>{if(!this.room)return;const before=structuredClone(this.room.record);try{this.room.presence(this.online(ws));await this.persist();}catch{this.room.record=before;throw Error('ROOM_PRESENCE_COMMIT_FAILED');}this.broadcast();});}
  webSocketError(ws){ws.close(1011,'Connection error');return this.webSocketClose(ws);}
  alarm(){return this.serial(async()=>{
    if(!this.room)return;
    this.moderation=pruneModeration(this.moderation||emptyModeration());
    for(const ws of this.ctx.getWebSockets())if(ws.readyState===1){if(!ws.deserializeAttachment()?.id && Date.now()-(ws.deserializeAttachment()?.createdAt??0)>=10000)ws.close(1008,'Authentication required');else if(ws.deserializeAttachment()?.id && Date.now()-this.seen(ws)>=90000)ws.close(4000,'Heartbeat timeout');}
    const before=structuredClone(this.room.record);try{this.room.presence(this.online(),Date.now(),true);if(!this.room.record.closed && this.peers().length && this.room.nextBot())this.room.tick();await this.persist();}catch{this.room.record=before;throw Error('ROOM_ALARM_COMMIT_FAILED');}this.broadcast();
  });}
}
