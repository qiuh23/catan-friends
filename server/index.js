import http from 'node:http';
import { readFile, writeFile, rename, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Room, roomCode, fingerprint, ROOM_PATTERN, ROOM_TTL } from '../shared/room.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
export async function createServer({port=Number(process.env.PORT)||3005,host='0.0.0.0',dataDir=path.join(root,'.data'),development=false,botDelay=900}={}) {
  await mkdir(dataDir,{recursive:true});
  const rooms=new Map(), loading=new Map(), sockets=new Map(), timers=new Map(), queues=new Map(), rates=new Map();
  let stopping=false;
  const vite=development ? await (await import('vite')).createServer({root,server:{middlewareMode:true},appType:'spa'}) : null;
  const serial=(code,fn)=>{const p=(queues.get(code)||Promise.resolve()).then(fn); queues.set(code,p.catch(()=>{})); return p;};
  const save=async(code,room)=>{ const file=path.join(dataDir,`${code}.json`); await writeFile(`${file}.tmp`,JSON.stringify(room.record)); await rename(`${file}.tmp`,file); };
  async function getRoom(code) {
    if(rooms.has(code)) return rooms.get(code);
    if(loading.has(code)) return loading.get(code);
    const p=(async()=>{ let record; try { record=JSON.parse(await readFile(path.join(dataDir,`${code}.json`),'utf8')); } catch { throw new Error('房间不存在，请检查邀请码。'); }
      if(Date.now()-record.updatedAt>ROOM_TTL) throw new Error('房间已超过 48 小时未活动，请创建新房间。');
      const room=new Room(record); rooms.set(code,room); return room;
    })(); loading.set(code,p); try { return await p; } finally { loading.delete(code); }
  }
  const roomSockets=code=>[...sockets].filter(([ws,s])=>s.code===code && s.id && ws.readyState===WebSocket.OPEN);
  const send=(ws,data)=>{ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const broadcast=code=>{const peers=roomSockets(code), online=peers.map(([,s])=>s.id), room=rooms.get(code); if(room) for(const [ws,s] of peers) send(ws,room.snapshot(s.id,online));};
  function schedule(code) {
    if(stopping || timers.has(code) || !roomSockets(code).length || !rooms.get(code)?.nextBot()) return;
    timers.set(code,setTimeout(()=>{timers.delete(code); serial(code,async()=>{
      if(!roomSockets(code).length) return;
      const room=rooms.get(code), before=structuredClone(room.record);
      try { if(room.tick()) { await save(code,room); broadcast(code); } } catch(error) {room.record=before; console.error('Bot turn failed:',error.message); return;}
      schedule(code);
    }).catch(console.error);},botDelay));
  }
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  async function body(req) { let data=''; for await(const part of req) {data+=part; if(data.length>8192) throw new Error('请求过大。');} return JSON.parse(data); }
  function originAllowed(req) {
    if(!req.headers.origin) return true;
    try { return new URL(req.headers.origin).host===req.headers.host || (process.env.ALLOWED_ORIGINS||'').split(',').includes(req.headers.origin); } catch {return false;}
  }
  function rate(key,limit=120) { const now=Date.now(), old=rates.get(key); const v=old && old.until>now ? old : {n:0,until:now+60000}; rates.set(key,v); return ++v.n<=limit; }
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/api/')) {
        if(!originAllowed(req)) return json(res,403,{error:'不允许的请求来源。'});
        if(!rate(req.socket.remoteAddress)) return json(res,429,{error:'请求过于频繁，请稍后重试。'});
        if(url.pathname==='/api/health') return json(res,200,{ok:true,game:'catan-friends',version:'0.1.0'});
        if(url.pathname==='/api/rooms' && req.method==='POST') {
          const input=await body(req), hash=await fingerprint(input.token); let code=roomCode();
          for(let tries=0;tries<8;tries++) {
            try { await readFile(path.join(dataDir,`${code}.json`)); code=roomCode(); } catch(error) { if(error.code==='ENOENT') break; throw error; }
          }
          const room=new Room(); const id=room.join(hash,input.name);
          if(input.practice===true) {
            for(let i=0;i<2;i++) room.handle(id,{id:crypto.randomUUID(),revision:room.record.revision,action:{type:'addBot'}});
            room.handle(id,{id:crypto.randomUUID(),revision:room.record.revision,action:{type:'start'}});
          }
          await save(code,room); rooms.set(code,room); return json(res,201,{code});
        }
        return json(res,404,{error:'接口不存在。'});
      }
      if(vite) return vite.middlewares(req,res,()=>{res.writeHead(404);res.end();});
      const dist=path.join(root,'dist'), relative=decodeURIComponent(url.pathname);
      let file=path.resolve(dist,`.${relative}`);
      if(!file.startsWith(dist+path.sep) && file!==dist) {res.writeHead(403);return res.end();}
      if(relative==='/' || !path.extname(relative)) file=path.join(dist,'index.html');
      try {const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data);} catch {res.writeHead(404);res.end('Not found');}
    } catch(error) { json(res,400,{error:error.message}); }
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:8192});
  server.on('upgrade',(req,socket,head)=>{
    const match=/^\/api\/rooms\/([A-HJ-NP-Z2-9]{6})\/ws$/.exec(new URL(req.url,'http://localhost').pathname);
    if(!match) {if(!vite){socket.write('HTTP/1.1 404 Not Found\r\n\r\n');socket.destroy();}return;}
    if(!originAllowed(req) || !rate(`ws:${req.socket.remoteAddress}`,60)) {socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return;}
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
        message=JSON.parse(raw.toString()); const room=await getRoom(code);
        if(!session.id) {
          if(message.type!=='hello') throw new Error('请先加入房间。');
          const hash=await fingerprint(message.token), before=structuredClone(room.record);
          try {session.id=room.join(hash,message.name); room.record.updatedAt=Date.now(); await save(code,room);} catch(e){room.record=before;session.id=null;throw e;}
          clearTimeout(helloTimeout);
          for(const [other,s] of roomSockets(code)) if(other!==ws && s.id===session.id) {send(other,{type:'replaced'});other.close(4001,'Session replaced');}
          broadcast(code); schedule(code); return;
        }
        if(message.type==='ping') {send(ws,{type:'pong'});return;}
        if(message.type==='sync') {send(ws,room.snapshot(session.id,roomSockets(code).map(([,s])=>s.id)));return;}
        if(message.type!=='action') throw new Error('消息类型无效。');
        const before=structuredClone(room.record);
        try {const ack=room.handle(session.id,message);await save(code,room);send(ws,ack);broadcast(code);schedule(code);} catch(e){room.record=before;throw e;}
      } catch(error) {send(ws,{type:'error',id:message?.id,message:error.message,fatal:!session.id});if(session.id)broadcast(code);else ws.close(1008,'Join failed');}
    }).catch(error=>console.error(error)));
    ws.on('close',()=>{clearTimeout(helloTimeout);sockets.delete(ws);broadcast(code);});
    ws.on('error',()=>{});
  });
  const heartbeat=setInterval(()=>{for(const [ws,s] of sockets){if(!s.alive){ws.terminate();continue;}s.alive=false;ws.ping();} for(const [key,v] of rates)if(v.until<Date.now())rates.delete(key);},30000);
  const cleanup=setInterval(async()=>{
    for(const name of await readdir(dataDir)) if(/^[A-HJ-NP-Z2-9]{6}\.json$/.test(name)) {
      const code=name.slice(0,-5); if(roomSockets(code).length)continue;
      try {const record=rooms.get(code)?.record||JSON.parse(await readFile(path.join(dataDir,name),'utf8'));if(Date.now()-record.updatedAt>ROOM_TTL){await unlink(path.join(dataDir,name));rooms.delete(code);queues.delete(code);}} catch {}
    }
  },3600000); cleanup.unref();
  await new Promise(resolve=>server.listen(port,host,resolve));
  return {server,rooms,port:server.address().port,async close(){stopping=true;clearInterval(heartbeat);clearInterval(cleanup);for(const t of timers.values())clearTimeout(t);for(const ws of sockets.keys())ws.terminate();await Promise.all([...queues.values()]);await vite?.close();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=await createServer(); console.log(`卡坦岛好友桌 http://localhost:${app.port}`);
  const stop=async()=>{await app.close();process.exit(0);}; process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
