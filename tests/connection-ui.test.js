import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection } from '../src/connection.js';

test('closed/revoked notifications stop retries and reject pending actions',async()=>{
  const original={WebSocket:globalThis.WebSocket,location:globalThis.location};
  class Socket {
    static OPEN=1;
    constructor(url){this.url=url;this.readyState=1;this.sent=[];}
    send(data){this.sent.push(JSON.parse(data));}
    close(){this.readyState=3;this.onclose?.();}
    receive(data){this.onmessage({data:JSON.stringify(data)});}
  }
  globalThis.WebSocket=Socket;globalThis.location={protocol:'https:',host:'catan.example'};
  try {
    for(const [type,code] of [['closed',null],['removed',null],['removed','IDENTITY_REVOKED'],['closed','ROOM_CLOSED']]) {
      const events=[],statuses=[],connection=new Connection('ABC234','secret','小岛',()=>{},s=>statuses.push(s),()=>{},m=>events.push(m));
      try {
        connection.ws.onopen();assert.equal(connection.ws.url,'wss://catan.example/api/rooms/ABC234/ws');
        assert.deepEqual(connection.ws.sent[0],{type:'hello',token:'secret',name:'小岛'});
        connection.ws.receive({type:'state',revision:3,state:{}});
        const pending=connection.action({type:'ready',ready:true});
        const rejection=assert.rejects(pending,/身份失效/);
        connection.ws.receive(code?{type:'error',code,message:'身份失效',fatal:true}:{type,message:'身份失效'});await rejection;
        assert.equal(connection.stopped,true);assert.equal(statuses.at(-1),type);assert.equal(events[0].type,type);
        assert.equal(connection.pending.size,0);assert.equal(connection.reconnectTimer,undefined);
        connection.ws.receive({type:'closed',message:'late notification from the previous room'});
        assert.equal(events.length,1,'a closed connection cannot invalidate a newer room');
      } finally {connection.close();}
    }
    const terminal=[];const full=new Connection('ABC234','secret','小岛',()=>{},()=>{},()=>{},m=>terminal.push(m));
    try {full.ws.onopen();full.ws.receive({type:'error',fatal:true,message:'房间已满。'});assert.equal(terminal.length,0,'a full room or network error must not revoke a recoverable identity');}
    finally {full.close();}
  } finally {globalThis.WebSocket=original.WebSocket;globalThis.location=original.location;}
});

test('pending chat reconnect resends its original envelope and explicit retry can retain the message ID',async()=>{
  const original={WebSocket:globalThis.WebSocket,location:globalThis.location};
  class Socket {
    static OPEN=1;
    constructor(){this.readyState=1;this.sent=[];}
    send(raw){if(this.fail)throw Error('local transport failure');this.sent.push(JSON.parse(raw));}
    close(){this.readyState=3;this.onclose?.();}
    receive(message){this.onmessage({data:JSON.stringify(message)});}
  }
  globalThis.WebSocket=Socket;globalThis.location={protocol:'http:',host:'127.0.0.1'};
  const connection=new Connection('ABC234','secret','玩家',()=>{},()=>{},()=>{});
  try{
    await assert.rejects(connection.action({type:'chat',text:'尚未认证'}),/正在连接/);assert.equal(connection.pending.size,0);
    connection.ws.onopen();connection.ws.receive({type:'state',revision:7,state:{}});
    const pending=connection.action({type:'chat',text:'断线重试'},{id:'stable-message'}),first=connection.ws.sent.at(-1);
    connection.ws.close();clearTimeout(connection.reconnectTimer);connection.connect();connection.ws.onopen();connection.ws.receive({type:'state',revision:99,state:{}});
    assert.deepEqual(connection.ws.sent.at(-1),first,'a reconnect preserves both original ID and revision');
    connection.ws.receive({type:'ack',id:'stable-message',ok:true});await pending;
    connection.ws.fail=true;await assert.rejects(connection.action({type:'chat',text:'确认未知'},{id:'retry-after-failure'}),/发送失败/);assert.equal(connection.pending.size,0);
    connection.ws.fail=false;const retried=connection.action({type:'chat',text:'确认未知'},{id:'retry-after-failure'});assert.equal(connection.ws.sent.at(-1).id,'retry-after-failure');
    connection.ws.receive({type:'error',id:'retry-after-failure',message:'明确拒绝'});await assert.rejects(retried,error=>error.definitive===true);
  }finally{connection.close();globalThis.WebSocket=original.WebSocket;globalThis.location=original.location;}
});
