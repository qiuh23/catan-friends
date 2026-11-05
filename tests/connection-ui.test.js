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
