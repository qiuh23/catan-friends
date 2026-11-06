import { anchorChatPreview } from './chat-anchor.js';
// Only the fresh live tail produces a preview. History and reconnect hydration
// stay in the drawer; message IDs and transport acknowledgements are unchanged.
export class ChatPreview {
  constructor(open,mapObstacles=()=>[]) {
    this.mapObstacles=mapObstacles;
    this.root=document.createElement('div');this.root.className='chat-preview';this.root.hidden=true;
    this.root.setAttribute('aria-live','polite');this.root.setAttribute('aria-label','新聊天消息');
    this.button=document.createElement('button');this.button.type='button';
    this.name=document.createElement('strong');this.text=document.createElement('span');
    this.button.append(this.name,this.text);this.root.append(this.button);document.body.append(this.root);
    this.button.onclick=open;
    const position=()=>this.position();
    window.addEventListener('resize',position);visualViewport?.addEventListener('resize',position);visualViewport?.addEventListener('scroll',position);
    document.addEventListener('visibilitychange',()=>{this.hydrated=false;this.clear();});
  }
  clear(){clearTimeout(this.timer);this.message=null;this.root.hidden=true;}
  update(state,{connected,room,open=false}={}) {
    if(this.room!==room){this.room=room;this.latest=0;this.snapshot=null;this.hydrated=false;this.clear();}
    if(!state){this.hydrated=false;this.clear();return;}
    // Status callbacks precede the first restored snapshot. Re-rendering the
    // old object must not arm live notices for the reconnect backlog.
    const changed=state!==this.snapshot;this.snapshot=state;
    const messages=state.chat||[], latest=Math.max(this.latest||0,0,...messages.map(m=>m.seq));
    const fresh=this.hydrated&&connected&&changed?messages.filter(m=>m.seq>(this.latest||0)&&m.playerId!==state.me):[];
    this.latest=latest;if(changed||!connected||document.hidden)this.hydrated=connected&&!document.hidden;
    if(!connected||open||document.hidden){this.clear();return;}
    if(this.message&&!messages.some(m=>m.id===this.message.id))this.clear();
    const newest=fresh.at(-1);
    if(newest){
      this.message=newest;clearTimeout(this.timer);this.root.hidden=false;
      this.timer=setTimeout(()=>this.clear(),8000);
    }
    if(this.message){
      const current=messages.find(m=>m.id===this.message.id)||this.message;
      this.name.textContent=current.name;this.text.textContent=current.text;
      this.button.setAttribute('aria-label',`查看聊天记录，${current.name}：${current.text}`);
      this.position();
    }
  }
  position(){
    if(this.root.hidden)return;
    anchorChatPreview(this.root,document.querySelector('[data-action="openChat"]'),[...document.querySelectorAll('.player-circle,#play-dock,#hand,#turn-banner,.stage-primary,.stage-utilities > :not([data-action="openChat"])')],this.mapObstacles());
  }
}
