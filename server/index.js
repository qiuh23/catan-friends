import http from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { deploymentConfig, requestAddress, originAllowed } from './request-policy.js';
import { Room, roomCode, fingerprint, ROOM_PATTERN } from '../shared/room.js';
import { createRoomFromInput } from '../shared/room-create.js';
import { UserError,publicError } from '../shared/errors.js';
import { securityConfig,adminAuthorized,applyModeration,disposition,inspectRoom,closedModeration } from '../shared/moderation.js';
import { ModerationStore } from './moderation-store.js';
import { renameWithRetry } from './file-store.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
export async function createServer({port=Number(process.env.PORT)||3005,host=process.env.HOST||'0.0.0.0',dataDir=process.env.DATA_DIR||path.join(root,'.data'),staticDir=process.env.STATIC_DIR||path.join(root,'dist'),backendId=process.env.BACKEND_ID||'local',publicOrigin=process.env.PUBLIC_ORIGIN||'',trustProxy=process.env.TRUST_PROXY||'',development=false,botDelay=900,now=Date.now,security=process.env}={}) {
  const config=deploymentConfig({backendId,publicOrigin,trustProxy});
  let revision=process.env.BUILD_SHA||null;
  try {revision ||= JSON.parse(await readFile(path.join(staticDir,'build-info.json'),'utf8')).revision;}catch{}
  if(revision&&!/^[a-f0-9]{40}$/.test(revision))throw new Error('Invalid build revision.');
  const marker={ok:true,game:'catan-friends',backendId:config.backendId,revision};
  await mkdir(dataDir,{recursive:true});
  const moderation=new ModerationStore(path.join(dataDir,'moderation')),policy=securityConfig(security);
  const rooms=new Map(), loading=new Map(), sockets=new Map(), timers=new Map(), deadlines=new Map(), queues=new Map(), rates=new Map();
  let stopping=false;
  const vite=development ? await (await import('vite')).createServer({root,server:{middlewareMode:true},appType:'spa'}) : null;
  const serial=(code,fn)=>{const p=(queues.get(code)||Promise.resolve()).then(fn); queues.set(code,p.catch(()=>{})); return p;};
  const save=async(code,room)=>{
    if(room.record.closed){const previous=await moderation.read(code);if(previous.audit.length || previous.hiddenChat.length || Object.keys(previous.names).length || previous.restricted.length){const next=closedModeration(previous);if(next!==previous)await moderation.write(code,next);}}
    const file=path.join(dataDir,`${code}.json`);await writeFile(`${file}.tmp`,JSON.stringify(room.record));await renameWithRetry(`${file}.tmp`,file);
  };
  async function getRoom(code) {
    if(rooms.has(code)){const room=rooms.get(code);applyModeration(room,await moderation.read(code));return room;}
    if(loading.has(code)) return loading.get(code);
    const p=(async()=>{ let record; try { record=JSON.parse(await readFile(path.join(dataDir,`${code}.json`),'utf8')); } catch { throw new UserError('房间不存在，请检查邀请码。'); }
      const room=new Room(record,now());applyModeration(room,await moderation.read(code));room.presence([],now(),true);rooms.set(code,room);try{if(!record.closed || !record.closeReason)await save(code,room);}catch(error){rooms.delete(code);throw error;}armDeadline(code);return room;
    })(); loading.set(code,p); try { return await p; } finally { loading.delete(code); }
  }
  const roomSockets=code=>[...sockets].filter(([ws,s])=>s.code===code && s.id && ws.readyState===WebSocket.OPEN);
  const send=(ws,data)=>{ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const broadcast=code=>{const peers=roomSockets(code),online=peers.map(([,s])=>s.id),room=rooms.get(code);if(room)for(const [ws,s] of peers){const state=room.snapshot(s.id,online,now());send(ws,state);if(state.type!=='state'){s.id=null;ws.close(4003,'Room membership ended');}}};
  function armDeadline(code){
    clearTimeout(deadlines.get(code));deadlines.delete(code);
    const until=rooms.get(code)?.deadline();if(stopping || until==null)return;
    const timer=setTimeout(()=>serial(code,async()=>{const room=rooms.get(code);if(!room)return;room.expire(now());await save(code,room);broadcast(code);armDeadline(code);}).catch(()=>console.error('ROOM_EXPIRY_FAILED')),Math.max(1,Math.min(2147483647,until-now())));timer.unref();deadlines.set(code,timer);
  }
  async function presence(code,recover=false,notify=true){const room=rooms.get(code);if(!room)return;if(room.record.closed){broadcast(code);armDeadline(code);return;}const before=structuredClone(room.record);try{room.presence(roomSockets(code).map(([,s])=>s.id),now(),recover);await save(code,room);}catch(error){room.record=before;throw error;}if(notify || before.hostConnected!==room.record.hostConnected || room.record.closed)broadcast(code);armDeadline(code);}
  async function sweep(){
    for(const name of await readdir(dataDir))if(/^[A-HJ-NP-Z2-9]{6}\.json$/.test(name))await serial(name.slice(0,-5),async()=>{const code=name.slice(0,-5);try{await getRoom(code);await presence(code,true);}catch{console.error('ROOM_RECOVERY_FAILED');}});
    for(const code of await moderation.codes())await serial(code,()=>moderation.prune(code,now()));
  }
  function schedule(code) {
    if(stopping || timers.has(code) || !roomSockets(code).length || !rooms.get(code)?.nextBot()) return;
    timers.set(code,setTimeout(()=>{timers.delete(code); serial(code,async()=>{
      if(!roomSockets(code).length) return;
      const room=rooms.get(code);if(room.expire(now())){await save(code,room);broadcast(code);return;}const before=structuredClone(room.record);
      try { if(room.tick(now())) { await save(code,room); broadcast(code); } } catch {room.record=before; console.error('BOT_COMMIT_FAILED'); return;}
      schedule(code);
    }).catch(()=>console.error('BOT_SCHEDULING_FAILED'));},botDelay));
  }
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  async function body(req) { let data=''; for await(const part of req) {data+=part; if(data.length>8192) throw new Error('请求过大。');} return JSON.parse(data); }
  function rate(key,limit=120) { const now=Date.now(), old=rates.get(key); const v=old && old.until>now ? old : {n:0,until:now+60000}; rates.set(key,v); return ++v.n<=limit; }
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/api/')) {
        if(!originAllowed(req,config.publicOrigin)) return json(res,403,{error:'不允许的请求来源。'});
        if(!rate(requestAddress(req,config.trustProxy))) return json(res,429,{error:'请求过于频繁，请稍后重试。'});
        if(url.pathname==='/api/health') return json(res,200,marker);
        if(url.pathname==='/api/deployment') return json(res,200,{...marker,publicOrigin:config.publicOrigin||null});
        if(url.pathname==='/api/security/contact')return json(res,200,policy);
        const admin=/^\/api\/stationmaster\/rooms\/([A-HJ-NP-Z2-9]{6})$/.exec(url.pathname);
        if(admin) {
          if(!await adminAuthorized(req.headers.authorization,security))return json(res,403,{error:'无站长权限或尚未配置。'});
          if(req.method!=='POST')return json(res,405,{error:'需要 POST 请求。'});
          const input=await body(req),code=admin[1];
          return await serial(code,async()=>{
            const room=await getRoom(code),state=await moderation.read(code),next=disposition(room,state,input,policy,now());
            // Persist evidence and enforcement first. Reapply it on every load,
            // including after restoring an older game-only backup.
            await moderation.write(code,next.state);applyModeration(room,next.state);await save(code,room);
            broadcast(code);await presence(code);armDeadline(code);
            return json(res,200,input.action==='inspect'?inspectRoom(room,next.state,now()):next.result);
          });
        }
        if(url.pathname==='/api/rooms' && req.method==='GET') {
          const cursor=url.searchParams.get('cursor');if(cursor && !ROOM_PATTERN.test(cursor))return json(res,400,{error:'列表分页参数无效。'});
          await sweep();const visible=[...rooms].sort(([a],[b])=>a.localeCompare(b)).filter(([code])=>!cursor || code>cursor).map(([code,room])=>room.summary(code,now())).filter(Boolean),page=visible.slice(0,40);
          return json(res,200,{rooms:page,nextCursor:visible.length>40?page.at(-1).code:null,serverNow:now()});
        }
        if(url.pathname==='/api/rooms' && req.method==='POST') {
          const room=await createRoomFromInput(await body(req),now());let code;
          // Reserve the name with an exclusive initial write, including tombstones.
          // Two simultaneous creates must never overwrite each other's identity.
          for(let tries=0;tries<8;tries++){const candidate=roomCode();try{await writeFile(path.join(dataDir,`${candidate}.json`),JSON.stringify(room.record),{flag:'wx'});code=candidate;break;}catch(error){if(error.code!=='EEXIST')throw error;}}
          if(!code)return json(res,503,{error:'房间码分配失败，请重试。'});
          rooms.set(code,room);armDeadline(code);return json(res,201,{code});
        }
        return json(res,404,{error:'接口不存在。'});
      }
      if(vite) return vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});
      const dist=path.resolve(staticDir), relative=decodeURIComponent(url.pathname);
      let file=path.resolve(dist,`.${relative}`);
      if(!file.startsWith(dist+path.sep) && file!==dist) {res.writeHead(403);return res.end();}
      if(relative==='/' || !path.extname(relative)) file=path.join(dist,'index.html');
      try {const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data);} catch {res.writeHead(404);res.end('Not found');}
    } catch(error) { json(res,error instanceof UserError?400:503,{error:publicError(error).message}); }
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:8192});
  server.on('upgrade',(req,socket,head)=>{
    if(new URL(req.url,'http://localhost').pathname==='/api/connectivity/ws'){
      if(!originAllowed(req,config.publicOrigin)||!rate(`ws:${requestAddress(req,config.trustProxy)}`,60)){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return;}
      wss.handleUpgrade(req,socket,head,ws=>{ws.send(JSON.stringify(marker));ws.close(1000,'Connectivity checked');});return;
    }
    const match=/^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})\/ws$/.exec(new URL(req.url,'http://localhost').pathname);
    if(!match) {if(!vite){socket.write('HTTP/1.1 404 Not Found\r\n\r\n');socket.destroy();}return;}
    if(!originAllowed(req,config.publicOrigin) || !rate(`ws:${requestAddress(req,config.trustProxy)}`,60)) {socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,match[1]));
  });
  wss.on('connection',(ws,code)=>{
    const session={code,id:null,alive:true,n:0,window:Date.now()}; sockets.set(ws,session);
    const helloTimeout=setTimeout(()=>{if(!session.id)ws.close(1008,'Authentication required');},10000);
    ws.on('pong',()=>session.alive=true);
    ws.on('message',raw=>serial(code,async()=>{
      let message;
      try {
        if(Date.now()-session.window>10000){session.window=Date.now();session.n=0;}
        if(++session.n>60) throw new Error('操作过于频繁。');
        message=JSON.parse(raw.toString());const room=await getRoom(code);await presence(code,true,false);
        if(room.expire(now())){await save(code,room);broadcast(code);}room.assertOpen(now());
        if(!session.id) {
          if(message.type!=='hello') throw new Error('请先加入房间。');
          const hash=await fingerprint(message.token), before=structuredClone(room.record);
          try {session.id=room.join(hash,message.name,now());room.presence(roomSockets(code).map(([,s])=>s.id),now());await save(code,room);} catch(e){room.record=before;session.id=null;throw e;}
          clearTimeout(helloTimeout);
          for(const [other,s] of roomSockets(code)) if(other!==ws && s.id===session.id) {send(other,{type:'replaced'});other.close(4001,'Session replaced');}
          broadcast(code);armDeadline(code);schedule(code);return;
        }
        if(message.type==='ping') {send(ws,{type:'pong'});return;}
        if(message.type==='sync') {send(ws,room.snapshot(session.id,roomSockets(code).map(([,s])=>s.id),now()));return;}
        if(message.type!=='action') throw new Error('消息类型无效。');
        const before=structuredClone(room.record);
        try {const ack=room.handle(session.id,message,now());
          if(message.action?.type==='leave'){session.id=null;room.presence(roomSockets(code).map(([,s])=>s.id),now());}
          else room.presence(roomSockets(code).map(([,s])=>s.id),now());
          await save(code,room);send(ws,ack);broadcast(code);armDeadline(code);schedule(code);if(message.action?.type==='leave')ws.close(1000,'Left room');
        } catch(e){room.record=before;throw e;}
      } catch(error) {send(ws,{type:'error',id:typeof message?.id==='string'?message.id.slice(0,80):undefined,...publicError(error),fatal:!session.id});if(session.id)broadcast(code);else ws.close(1008,'Join failed');}
    }).catch(()=>console.error('ROOM_MESSAGE_FAILED')));
    ws.on('close',()=>{clearTimeout(helloTimeout);sockets.delete(ws);if(!stopping)serial(code,()=>presence(code)).catch(()=>console.error('ROOM_PRESENCE_FAILED'));});
    ws.on('error',()=>{});
  });
  const heartbeat=setInterval(()=>{for(const [ws,s] of sockets){if(!s.alive){ws.terminate();continue;}s.alive=false;ws.ping();}for(const [key,v] of rates)if(v.until<Date.now())rates.delete(key);sweep().catch(()=>console.error('ROOM_SWEEP_FAILED'));},30000);heartbeat.unref();
  await sweep();
  await new Promise(resolve=>server.listen(port,host,resolve));
  return {server,rooms,sweep,port:server.address().port,async close(){stopping=true;clearInterval(heartbeat);for(const t of [...timers.values(),...deadlines.values()])clearTimeout(t);for(const ws of sockets.keys())ws.terminate();await Promise.all([...queues.values()]);for(const [code,room] of rooms){room.presence([],now());await save(code,room);}await vite?.close();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=await createServer(); console.log(`卡坦岛好友桌 http://localhost:${app.port}`);
  const stop=async()=>{await app.close();process.exit(0);}; process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
