const eventKinds = new Set(['road','settlement','city','robber','blocked','production','roll','steal','development','trade','discard','award']);
const targetLists = {edge:'edges',vertex:'vertices',tile:'tiles'};

// Consume only the authoritative public stream. No comparison of private hands,
// development cards, offers, logs, or rendering state is needed for feedback.
function publicEvent(event, state) {
  if (!event || !Number.isSafeInteger(event.id) || event.id < 1 || !eventKinds.has(event.kind) || !state.players?.some(p=>p.id===event.actorId) || typeof event.text!=='string') return null;
  const targets=(Array.isArray(event.targets)?event.targets:[]).filter(t=>targetLists[t?.kind] && Number.isSafeInteger(t.id) && t.id>=0 && state.board?.[targetLists[t.kind]]?.some(item=>item.id===t.id)).map(({kind,id})=>({kind,id}));
  return {id:event.id,kind:event.kind,actorId:event.actorId,text:event.text.slice(0,300),targets};
}

export class ActionFeedbackCursor {
  constructor() { this.reset(); }
  reset() { this.key=null;this.sequence=0;this.suspended=true; }
  consume(state, {connected=true,roomKey=''}={}) {
    if (!connected) {this.suspended=true;return [];}
    const stream=state?.presentation;
    if (!state?.board || !stream || typeof stream.epoch!=='string' || !Number.isSafeInteger(stream.sequence) || stream.sequence<0 || !Array.isArray(stream.events)) {this.key=null;this.sequence=0;return [];}
    const key=JSON.stringify([roomKey,stream.epoch]);
    // Initial load, refresh, reconnect, room switch and rematch hydrate at the
    // current head. Catch-up history must never move the camera.
    if(this.suspended || key!==this.key) {this.key=key;this.sequence=stream.sequence;this.suspended=false;return [];}
    if(stream.sequence<this.sequence)return [];
    const previous=this.sequence;
    this.sequence=Math.max(this.sequence,stream.sequence);
    const oldest=Math.min(...stream.events.filter(event=>Number.isSafeInteger(event?.id)).map(event=>event.id));
    if(oldest>previous+1)return [];
    const seen=new Set();
    return stream.events.filter(event=>event?.id>previous && event.id<=stream.sequence).toSorted((a,b)=>a.id-b.id).map(event=>publicEvent(event,state)).filter(event=>event && !seen.has(event.id) && seen.add(event.id));
  }
}

// One burst becomes one nonmodal notice and one set of highlighted locations.
// The newest event id is only an identity; eventIds preserves source order.
export function mergeFeedbackEvents(events) {
  const ordered=[...new Map(events.filter(Boolean).toSorted((a,b)=>a.id-b.id).map(event=>[event.id,event])).values()];
  if(!ordered.length)return null;
  const targets=[...new Map(ordered.flatMap(event=>event.targets||[]).map(t=>[`${t.kind}:${t.id}`,{kind:t.kind,id:t.id}])).values()];
  const actorIds=[...new Set(ordered.map(event=>event.actorId))];
  const groups=new Map();
  for(const event of ordered) {
    const key=JSON.stringify([event.kind,event.actorId,event.text]);
    if(groups.has(key))groups.get(key).count++;
    else groups.set(key,{text:event.text,count:1});
  }
  const shown=[...groups.values()].slice(0,2),remaining=ordered.length-shown.reduce((count,group)=>count+group.count,0);
  const text=shown.map(group=>`${group.text}${group.count>1?`（${group.count} 次）`:''}`).join(' · ')+(remaining?` 另有 ${remaining} 项公开行动。`:'');
  const targetKinds=Object.fromEntries(ordered.flatMap(event=>(event.targets||[]).map(t=>[`${t.kind}:${t.id}`,event.kind])));
  return {...ordered.at(-1),bubbleTarget:ordered.at(-1).targets?.at(-1)||null,latestText:ordered.at(-1).text,kind:ordered.length===1?ordered[0].kind:'summary',text,targets,targetKinds,eventIds:ordered.map(event=>event.id),actorIds,count:ordered.length};
}
