// Test-only authority access. This entrypoint is never shipped by Wrangler.
import worker,{CatanRoom} from '../../worker/index.js';
import {Room} from '../../shared/room.js';
export default worker;
export class CatanTestRoom extends CatanRoom {
  async persist(){
    if(this.failAfter===0){this.failAfter=null;throw Error('injected-private-state:'+JSON.stringify(this.room.record.random));}
    if(this.failAfter>0)this.failAfter--;
    return super.persist();
  }
  fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/__fixture/read')return this.serial(()=>Response.json({record:this.room?.record,moderation:this.moderation}));
    if(path==='/__fixture/replace')return this.serial(async()=>{this.room=new Room(await request.json());await this.persist();return Response.json({ok:true});});
    if(path==='/__fixture/fail-next-command')return this.serial(()=>{this.failAfter=1;return Response.json({ok:true});});
    return super.fetch(request);
  }
}
