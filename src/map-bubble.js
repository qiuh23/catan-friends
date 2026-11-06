const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
// The anchor never moves. Only the label is placed in nearby clear screen space.
export function placeMapBubble(anchor,size,viewport,obstacles=[]) {
  const gap=16,pad=8,{width,height}=size;
  const candidates=[[-width/2,-height-gap],[gap,-height/2],[-width-gap,-height/2],[-width/2,gap],[-width/2-55,-height-gap],[-width/2+55,-height-gap]];
  for(const extra of [28,56,90,128,180,240])for(const shift of [0,-45,45])candidates.push([-width/2+shift,-height-gap-extra],[-width/2+shift,gap+extra],[gap+extra,-height/2+shift],[-width-gap-extra,-height/2+shift]);
  let best;
  for(const [dx,dy]of candidates){
    const box={x:Math.max(pad,Math.min(viewport.width-width-pad,anchor.x+dx)),y:Math.max(pad,Math.min(viewport.height-height-pad,anchor.y+dy)),width,height};
    const blocked=obstacles.reduce((sum,r)=>sum+overlap(box,r),0);
    const edge={x:Math.max(box.x,Math.min(box.x+width,anchor.x)),y:Math.max(box.y,Math.min(box.y+height,anchor.y))};
    const distance=Math.hypot(edge.x-anchor.x,edge.y-anchor.y),score=blocked*100+distance;
    if(!best||score<best.score)best={...box,edge,score,blocked};
  }
  return best;
}
