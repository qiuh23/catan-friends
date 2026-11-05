import { newId } from './id.js';
export class Connection {
  constructor(code,token,name,onState,onStatus,onError) {
    Object.assign(this,{code,token,name,onState,onStatus,onError});this.revision=0;this.pending=new Map();this.retry=0;this.stopped=false;this.heartbeat=null;this.connect();
  }
  connect(){
    if(this.stopped)return;
    this.onStatus(this.retry ? 'reconnecting' : 'connecting');
    const ws=this.ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/rooms/${this.code}/ws`);
    const timeout=setTimeout(()=>{if(ws.readyState!==WebSocket.OPEN)ws.close();},10000);
    ws.onopen=()=>{clearTimeout(timeout);ws.send(JSON.stringify({type:'hello',token:this.token,name:this.name}));};
    ws.onmessage=event=>{
      const m=JSON.parse(event.data);
      if(m.type==='state') {
        this.revision=m.revision;this.hasState=true;this.retry=0;this.onStatus('connected');this.onState(m.state,m.revision);
        // Resend the original envelope, never invent a new action id after a disconnect.
        for(const p of this.pending.values())if(!p.sent){ws.send(JSON.stringify(p.message));p.sent=true;}
      } else if(m.type==='ack' || m.type==='error' && m.id) {
        const p=this.pending.get(m.id);if(p){clearTimeout(p.timeout);this.pending.delete(m.id);m.type==='ack'?p.resolve():p.reject(new Error(m.message));}
      } else if(m.type==='error') {this.onError(m.message);if(m.fatal){this.stopped=true;this.onStatus('failed');ws.close();}}
      else if(m.type==='replaced'){this.stopped=true;this.onStatus('replaced');this.onError('该座位已在另一个页面打开。');ws.close();}
    };
    ws.onclose=()=>{clearTimeout(timeout);clearInterval(this.heartbeat);for(const p of this.pending.values())p.sent=false;if(this.stopped)return;if(!this.hasState&&this.retry>=5){this.stopped=true;this.onStatus('failed');this.onError('无法加入房间，请检查房间码和服务是否在线。');return;}this.onStatus('reconnecting');this.reconnectTimer=setTimeout(()=>this.connect(),Math.min(8000,500*2**this.retry++));};
    ws.onerror=()=>{};
    this.heartbeat=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send('{"type":"ping"}');},20000);
  }
  action(action){
    if(this.ws.readyState!==WebSocket.OPEN || this.stopped)return Promise.reject(new Error('正在连接房间，请稍后再试。'));
    const message={type:'action',id:newId(),revision:this.revision,action};
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.pending.delete(message.id);reject(new Error('操作确认超时，请核对棋盘最新状态。'));if(this.ws.readyState===WebSocket.OPEN)this.ws.send('{"type":"sync"}');},15000);
      this.pending.set(message.id,{message,resolve,reject,timeout,sent:true});this.ws.send(JSON.stringify(message));
    });
  }
  close(){this.stopped=true;clearTimeout(this.reconnectTimer);clearInterval(this.heartbeat);this.ws.close();for(const p of this.pending.values()){clearTimeout(p.timeout);p.reject(new Error('已离开房间。'));}this.pending.clear();}
}
