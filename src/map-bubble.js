const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
// The anchor never moves. Only the label is placed in nearby clear screen space.
export function placeMapBubble(anchor,size,viewport,obstacles=[],previous=null) {
  const gap=16,pad=8,{width,height}=size;
  const candidates=[[-width/2,-height-gap],[gap,-height/2],[-width-gap,-height/2],[-width/2,gap],[-width/2-55,-height-gap],[-width/2+55,-height-gap]];
  for(const extra of [28,56,90,128,180,240])for(const shift of [0,-45,45])candidates.push([-width/2+shift,-height-gap-extra],[-width/2+shift,gap+extra],[gap+extra,-height/2+shift],[-width-gap-extra,-height/2+shift]);
  // Keep a clear previous location while the anchor moves. Only a meaningful
  // distance improvement may move it; subpixel scoring cannot flip sides.
  const scoreBox=box=>{
    const blocked=obstacles.reduce((sum,r)=>sum+overlap(box,r),0);
    const edge={x:Math.max(box.x,Math.min(box.x+width,anchor.x)),y:Math.max(box.y,Math.min(box.y+height,anchor.y))};
    return {...box,edge,blocked,score:blocked*100+Math.hypot(edge.x-anchor.x,edge.y-anchor.y)};
  };
  let best;
  for(const [dx,dy]of candidates){
    const box={x:Math.max(pad,Math.min(viewport.width-width-pad,anchor.x+dx)),y:Math.max(pad,Math.min(viewport.height-height-pad,anchor.y+dy)),width,height};
    const candidate=scoreBox(box),score=candidate.score;
    if(!best||score<best.score)best=candidate;
  }
  if(previous&&previous.x>=pad&&previous.y>=pad&&previous.x+width<=viewport.width-pad&&previous.y+height<=viewport.height-pad){
    const held=scoreBox({x:previous.x,y:previous.y,width,height});
    if(held.blocked===0&&held.score<=best.score+72)return held;
  }
  return best;
}

// Once obstructed, require a short clear interval before revealing the bubble.
// Never draw over a token during the interval or alternate visible/hidden on
// successive camera frames near the edge of an obstacle.
export class BubbleVisibility {
  constructor(delay=120) {this.delay=delay;this.blocked=false;this.clearAt=null;}
  update(clear,now) {
    if(!clear){this.blocked=true;this.clearAt=null;return false;}
    if(!this.blocked)return true;
    this.clearAt??=now;
    if(now-this.clearAt<this.delay)return false;
    this.blocked=false;this.clearAt=null;return true;
  }
}
