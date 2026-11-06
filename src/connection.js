import { DOMESTIC } from './site-config.js';
import { newId } from './id.js';
export class Connection {
  constructor(code,token,name,onState,onStatus,onError,onTerminal=()=>{}) {
    Object.assign(this,{code,token,name,onState,onStatus,onError,onTerminal});this.revision=0;this.pending=new Map();this.retry=0;this.stopped=false;this.heartbeat=null;this.connect();
  }
  connect(){
    if(this.stopped)return;
    this.ready=false;
    this.onStatus(this.retry ? 'reconnecting' : 'connecting');
    const ws=this.ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/rooms/${this.code}/ws`);
    const timeout=setTimeout(()=>{if(ws.readyState!==WebSocket.OPEN)ws.close();},10000);
    ws.onopen=()=>{clearTimeout(timeout);if(this.stopped||ws!==this.ws)return ws.close();ws.send(JSON.stringify({type:'hello',token:this.token,...(DOMESTIC?{nicknameId:this.name}:{name:this.name})}));};
    ws.onmessage=event=>{
      if(this.stopped||ws!==this.ws)return;
      const m=JSON.parse(event.data);
      if(m.type==='error'&&['IDENTITY_REVOKED','ROOM_CLOSED'].includes(m.code)){
        this.stopped=true;this.rejectPending(m.message||'原身份已失效。');
        const type=m.code==='IDENTITY_REVOKED'?'removed':'closed';this.onStatus(type);this.onTerminal({type,message:m.message});ws.close();return;
      }
      if(m.type==='state') {
        this.revision=m.revision;this.hasState=true;this.ready=true;this.retry=0;this.onStatus('connected');this.onState(m.state,m.revision);
        // Resend the original envelope, never invent a new action id after a disconnect.
        for(const p of this.pending.values())if(!p.sent){try{ws.send(JSON.stringify(p.message));p.sent=true;}catch{ws.close();break;}}
      } else if(m.type==='ack' || m.type==='error' && m.id) {
        const p=this.pending.get(m.id);if(p){clearTimeout(p.timeout);this.pending.delete(m.id);m.type==='ack'?p.resolve():p.reject(Object.assign(new Error(m.message),{definitive:true}));}
      } else if(m.type==='error') {this.onError(m.message);if(m.fatal){this.stopped=true;this.onStatus('failed');ws.close();}}
      else if(m.type==='closed'||m.type==='removed'){this.stopped=true;this.onStatus(m.type);this.rejectPending(m.message||'房间身份已失效。');this.onTerminal(m);ws.close();}
      else if(m.type==='replaced'){this.stopped=true;this.onStatus('replaced');this.rejectPending('该座位已在另一个页面打开。');this.onError('该座位已在另一个页面打开。');ws.close();}
    };
    ws.onclose=()=>{clearTimeout(timeout);if(ws!==this.ws)return;clearInterval(this.heartbeat);for(const p of this.pending.values())p.sent=false;if(this.stopped)return;if(!this.hasState&&this.retry>=5){this.stopped=true;this.onStatus('failed');this.rejectPending('无法加入房间。');this.onError('无法加入房间，请检查房间码和服务是否在线。');return;}this.onStatus('reconnecting');this.reconnectTimer=setTimeout(()=>this.connect(),Math.min(8000,500*2**this.retry++));};
    ws.onerror=()=>{};
    this.heartbeat=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send('{"type":"ping"}');},20000);
  }
  action(action,{id=newId()}={}){
    if(this.ws.readyState!==WebSocket.OPEN || this.stopped || !this.ready)return Promise.reject(new Error('正在连接房间，请稍后再试。'));
    if(this.pending.has(id))return Promise.reject(new Error('上一条消息仍在等待确认。'));
    const message={type:'action',id,revision:this.revision,action};
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.pending.delete(message.id);reject(new Error('操作确认超时，请核对棋盘最新状态。'));if(this.ws.readyState===WebSocket.OPEN)this.ws.send('{"type":"sync"}');},15000);
      this.pending.set(message.id,{message,resolve,reject,timeout,sent:true});
      try{this.ws.send(JSON.stringify(message));}catch{clearTimeout(timeout);this.pending.delete(message.id);reject(new Error('消息发送失败，请稍后重试。'));}
    });
  }
  rejectPending(message){for(const p of this.pending.values()){clearTimeout(p.timeout);p.reject(new Error(message));}this.pending.clear();}
  close(){this.stopped=true;clearTimeout(this.reconnectTimer);clearInterval(this.heartbeat);this.ws.close();this.rejectPending('已离开房间。');}
}
