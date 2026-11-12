// One owner per notice channel: new arrivals never replace visible content or
// restart its lifetime. Pending public actions may be merged without a backlog.
export class NoticeQueue {
  constructor({show, duration=()=>3200, key=item=>item, merge, pendingLimit=Infinity, delay=0, setTimer=(fn,ms)=>setTimeout(fn,ms), clearTimer=id=>clearTimeout(id), now=()=>performance.now()}) {
    Object.assign(this,{show,duration,key,merge,pendingLimit,delay,setTimer,clearTimer,now});
    this.current=null;this.pending=[];this.omitted=0;this.timer=null;this.generation=0;this.paused=false;
  }
  schedule(ms,callback) {
    this.cancel();const generation=this.generation;
    this.remaining=ms;this.deadline=this.now()+ms;this.callback=callback;
    if(!this.paused)this.timer=this.setTimer(()=>{if(generation!==this.generation)return;this.timer=null;this.callback=null;callback();},ms);
  }
  cancel() {this.generation++;if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;this.callback=null;}
  push(item) {
    const key=this.key(item);
    if(this.current!==null&&this.key(this.current)===key||this.pending.some(value=>this.key(value)===key))return;
    this.pending.push(item);
    if(this.merge&&this.pending.length>this.pendingLimit){this.pending.shift();this.omitted++;}
    if(this.current===null&&!this.callback)this.schedule(this.delay,()=>this.advance());
  }
  advance() {
    this.current=this.pending.length?(this.merge?this.merge(this.pending.splice(0),this.omitted):this.pending.shift()):null;
    this.omitted=0;this.show(this.current);
    if(this.current!==null)this.schedule(this.duration(this.current),()=>this.advance());
  }
  pause(value=true) {
    if(this.paused===value)return;
    this.paused=value;
    if(!this.callback)return;
    const callback=this.callback,remaining=value?Math.max(0,this.deadline-this.now()):this.remaining;
    this.cancel();this.schedule(remaining,callback);
  }
  clear() {this.cancel();this.pending=[];this.omitted=0;this.current=null;this.show(null);}
}
