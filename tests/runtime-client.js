import assert from 'node:assert/strict';
export class RuntimeClient {
  constructor(ws){this.ws=ws;this.messages=[];ws.addEventListener('message',event=>{const message=JSON.parse(event.data.toString());this.messages.push(message);if(message.type==='state')this.state=message;});}
  async wait(predicate,after=0){for(let i=0;i<500;i++){const value=this.messages.slice(after).find(predicate);if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Runtime message timeout');}
  async request(action,{id=crypto.randomUUID(),revision=this.state.revision}={}){
    const after=this.messages.length,envelope={type:'action',id,revision,action};this.ws.send(JSON.stringify(envelope));
    const result=await this.wait(message=>message.id===id,after);
    if(result.type==='ack' && !['leave','close'].includes(action.type))await this.wait(message=>message.type==='state',after);
    return {result,envelope};
  }
  async act(action,extra){const {result,envelope}=await this.request(action,extra);assert.equal(result.type,'ack',JSON.stringify(result));return envelope;}
  close(){try{this.ws.close();}catch{}}
}
